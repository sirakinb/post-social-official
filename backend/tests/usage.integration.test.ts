// @vitest-environment node
//
// Usage reporting, the daily API-call limit, and keys ending when their maker leaves, on
// the dev database: `npm run test:db`.
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSql } from "../lib/insforge-admin";
import { callerForKey, keyActions } from "../lib/api/keys";
import { callerForAccessToken } from "../lib/oauth/server";
import { usageReport } from "../lib/usage";
import type { Caller } from "../lib/access";
import { createApiHandler } from "../functions/api/handler";
import { createAccount, resolveTarget, type AccountResult } from "../../scripts/lib/accounts";
import { api, uniqueSuffix } from "./dev-backend";

const enabled = process.env.INSFORGE_INTEGRATION === "1";

describe.skipIf(!enabled)("usage and limits on the dev backend (US-045)", () => {
  const target = enabled ? resolveTarget("dev", path.resolve(__dirname, "../..")) : null!;
  const sql = enabled ? createSql(target.baseUrl, target.adminKey) : null!;
  const suffix = uniqueSuffix();
  const planId = `tiny-${suffix}`;
  let owner: AccountResult;
  let admin: AccountResult;
  let facebook = "";
  let threads = "";
  let key = "";

  const person = (who: AccountResult): Caller => ({ userId: who.userId, displayName: "Person", entryPoint: "ui" });
  const handler = () =>
    createApiHandler({
      sql, r2: {} as never, newId: () => crypto.randomUUID(), webAppUrl: "http://localhost:3333", publicApiUrl: "http://localhost:3333/api",
      callerForKey, callerForAccessToken, userForToken: async () => null, allowedOrigins: [],
    });
  const call = async (url: string, body?: unknown) => {
    const response = await handler()(new Request(`https://fn${url}`, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${key}` }, body: body ? JSON.stringify(body) : undefined }));
    return { status: response.status, headers: response.headers, body: (await response.json().catch(() => null)) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };

  beforeAll(async () => {
    owner = await createAccount(target, { role: "owner", email: `use-${suffix}@postsocial.test`, displayName: "Owner", password: `Use-${suffix}-pass-1`, workspaceName: `Usage Test ${suffix}` });
    admin = await createAccount(target, { role: "owner", email: `use-adm-${suffix}@postsocial.test`, displayName: "Admin", password: `Use-${suffix}-pass-2`, workspaceName: `Usage Adm ${suffix}` });
    await sql(`UPDATE public.workspaces SET publishing_paused = true WHERE id = ANY($1::uuid[])`, [[owner.workspaceId, admin.workspaceId]]);
    const make = async (platform: string) =>
      (await sql<{ id: string }>(
        `INSERT INTO public.connected_accounts (workspace_id, platform, external_account_id, handle, display_name, capabilities) VALUES ($1, $2, $3, $3, $4, '{}') RETURNING id`,
        [owner.workspaceId, platform, `${platform}-use-${suffix}`, `Test ${platform}`],
      ))[0].id;
    facebook = await make("facebook");
    threads = await make("threads");
    key = (await keyActions.create(sql, person(owner), { workspace_id: owner.workspaceId, name: "Usage Bot", mode: "live" })).key;
  }, 120_000);

  afterAll(async () => {
    for (const who of [owner, admin].filter(Boolean)) {
      await api(target.baseUrl, target.adminKey, "DELETE", `/api/database/records/workspaces?id=eq.${who.workspaceId}`);
      await api(target.baseUrl, target.adminKey, "DELETE", "/api/auth/users", { userIds: [who.userId] });
    }
    await sql(`DELETE FROM public.plans WHERE id = $1`, [planId]);
  }, 60_000);

  it("reports posts by account and by who made them, AI calls, and plan limits", async () => {
    // The AI makes two drafts through the API; the worker "publishes" two destinations.
    for (const accountId of [facebook, threads]) {
      const made = await call("/v1/posts", { caption: `Hi ${accountId}`, draft: true, destinations: [{ account_id: accountId, options: { media_type: "text" } }] });
      expect(made.status).toBe(201);
    }
    const [bot] = await sql<{ id: string }>(`SELECT a.id FROM public.actors a JOIN public.api_keys k ON k.id = a.api_key_id WHERE k.workspace_id = $1`, [owner.workspaceId]);
    await sql(
      `INSERT INTO public.usage_events (workspace_id, actor_id, connected_account_id, platform, event_type, quantity)
       VALUES ($1, $2, $3, 'facebook', 'post_published', 1), ($1, $2, $3, 'facebook', 'post_published', 1), ($1, NULL, $4, 'threads', 'post_published', 1)`,
      [owner.workspaceId, bot.id, facebook, threads],
    );

    const report = await usageReport(sql, person(owner), { workspace_id: owner.workspaceId, period: "last_7_days" });
    expect(report.totals).toMatchObject({ posts_published: 3, posts_created: 2, posts_created_by_ai: 2 });
    expect(report.totals.api_calls).toBeGreaterThanOrEqual(2);
    expect(report.by_account).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ account_id: facebook, platform: "facebook", posts_published: 2 }),
        expect.objectContaining({ account_id: threads, platform: "threads", posts_published: 1 }),
      ]),
    );
    expect(report.by_connection).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Usage Bot", kind: "API key", posts_created: 2, posts_published: 2, active: true })]));
    expect(report.daily).toHaveLength(7);
    expect(report.daily.at(-1)!.posts_published).toBe(3);
    expect(report.plan.limits.posts_per_month).toMatchObject({ used: 3, limit: 3000 });

    // The AI reads the same report through the API.
    const viaApi = await call("/v1/usage?period=last_7_days");
    expect(viaApi.body.totals.posts_published).toBe(3);
    await expect(usageReport(sql, person(admin), { workspace_id: owner.workspaceId })).rejects.toThrow(/not found/);
  });

  it("refuses API calls once the plan's daily limit is used, without counting them", async () => {
    const [{ today }] = await sql<{ today: string }>(
      `SELECT coalesce(sum(quantity), 0)::text AS today FROM public.usage_events WHERE workspace_id = $1 AND event_type = 'api_call' AND occurred_at >= date_trunc('day', now())`,
      [owner.workspaceId],
    );
    await sql(`INSERT INTO public.plans (id, name, max_connected_accounts, max_posts_per_month, max_media_storage_bytes, max_api_calls_per_day) VALUES ($1, 'Tiny', 5, 10, 1000000, $2)`, [planId, Number(today) + 1]);
    const [{ plan_id: before }] = await sql<{ plan_id: string }>(`SELECT plan_id FROM public.workspace_plans WHERE workspace_id = $1`, [owner.workspaceId]);
    await sql(`UPDATE public.workspace_plans SET plan_id = $2 WHERE workspace_id = $1`, [owner.workspaceId, planId]);
    expect((await call("/v1/me")).status).toBe(200);
    const refused = await call("/v1/me");
    expect(refused.status).toBe(429);
    expect(refused.body.error.message).toMatch(/^Your Tiny plan allows \d+ API calls a day/);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
    const [{ after }] = await sql<{ after: string }>(
      `SELECT coalesce(sum(quantity), 0)::text AS after FROM public.usage_events WHERE workspace_id = $1 AND event_type = 'api_call' AND occurred_at >= date_trunc('day', now())`,
      [owner.workspaceId],
    );
    expect(Number(after)).toBe(Number(today) + 1);
    await sql(`UPDATE public.workspace_plans SET plan_id = $2 WHERE workspace_id = $1`, [owner.workspaceId, before]);
  });

  it("a person's keys end when they leave or stop being an admin", async () => {
    await sql(`INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'admin')`, [owner.workspaceId, admin.userId]);
    const first = await keyActions.create(sql, person(admin), { workspace_id: owner.workspaceId, name: "Admin key", mode: "live" });
    await sql(`UPDATE public.workspace_members SET role = 'member' WHERE workspace_id = $1 AND user_id = $2`, [owner.workspaceId, admin.userId]);
    expect(await callerForKey(sql, first.key, "api")).toBeNull();
    // The owner's own key is untouched.
    expect(await callerForKey(sql, key, "api")).not.toBeNull();

    await sql(`UPDATE public.workspace_members SET role = 'admin' WHERE workspace_id = $1 AND user_id = $2`, [owner.workspaceId, admin.userId]);
    const second = await keyActions.create(sql, person(admin), { workspace_id: owner.workspaceId, name: "Admin key 2", mode: "live" });
    await sql(`DELETE FROM public.workspace_members WHERE workspace_id = $1 AND user_id = $2`, [owner.workspaceId, admin.userId]);
    expect(await callerForKey(sql, second.key, "api")).toBeNull();
  });
});

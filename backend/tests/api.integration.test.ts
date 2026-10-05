// @vitest-environment node
//
// The REST API, MCP server and API keys on the dev database: `npm run test:db`. The test
// workspace has publishing paused, so nothing is ever sent to a platform.
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSql } from "../lib/insforge-admin";
import { callerForKey, keyActions } from "../lib/api/keys";
import { callerForAccessToken } from "../lib/oauth/server";
import { postActions } from "../lib/publishing/service";
import type { Caller } from "../lib/access";
import { createApiHandler } from "../functions/api/handler";
import { createAccount, resolveTarget, type AccountResult } from "../../scripts/lib/accounts";
import { api, uniqueSuffix } from "./dev-backend";

const enabled = process.env.INSFORGE_INTEGRATION === "1";

describe.skipIf(!enabled)("API keys, REST API and MCP on the dev backend (US-040, US-041, US-043)", () => {
  const target = enabled ? resolveTarget("dev", path.resolve(__dirname, "../..")) : null!;
  const sql = enabled ? createSql(target.baseUrl, target.adminKey) : null!;
  const suffix = uniqueSuffix();
  let owner: AccountResult;
  let stranger: AccountResult;
  let facebook = "";
  let liveKey = "";
  let liveKeyId = "";
  let testKey = "";

  const person = (who: AccountResult): Caller => ({ userId: who.userId, displayName: "Owner", entryPoint: "ui" });
  const handler = () =>
    createApiHandler({
      sql,
      r2: { presignGet: async () => "https://r2.example/view" } as never,
      newId: () => crypto.randomUUID(),
      webAppUrl: "http://localhost:3333", analyticsPlatforms: [],
      publicApiUrl: "http://localhost:3333/api",
      callerForKey,
      callerForAccessToken,
      userForToken: async () => null,
      allowedOrigins: [],
    });
  const call = async (key: string, method: string, url: string, body?: unknown, headers: Record<string, string> = {}) => {
    const response = await handler()(
      new Request(`https://fn${url}`, { method, headers: { Authorization: `Bearer ${key}`, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tests read loosely shaped JSON replies
    return { status: response.status, headers: response.headers, body: (await response.json().catch(() => null)) as any };
  };
  const mcp = (key: string, method: string, params?: unknown) => call(key, "POST", "/mcp", { jsonrpc: "2.0", id: 1, method, params });
  const textPost = (caption: string, extra: Record<string, unknown> = {}) => ({ caption, destinations: [{ account_id: facebook, options: { media_type: "text" } }], ...extra });

  beforeAll(async () => {
    owner = await createAccount(target, {
      role: "owner", email: `api-${suffix}@postsocial.test`, displayName: "Owner", password: `Api-${suffix}-pass-1`, workspaceName: `API Test ${suffix}`,
    });
    stranger = await createAccount(target, {
      role: "owner", email: `api-other-${suffix}@postsocial.test`, displayName: "Other", password: `Api-${suffix}-pass-2`, workspaceName: `API Other ${suffix}`,
    });
    await sql(`UPDATE public.workspaces SET publishing_paused = true WHERE id = ANY($1::uuid[])`, [[owner.workspaceId, stranger.workspaceId]]);
    const [row] = await sql<{ id: string }>(
      `INSERT INTO public.connected_accounts (workspace_id, platform, external_account_id, handle, display_name, capabilities)
       VALUES ($1, 'facebook', $2, $2, 'Test Page', '{}') RETURNING id`,
      [owner.workspaceId, `fb-api-${suffix}`],
    );
    facebook = row.id;
    const live = await keyActions.create(sql, person(owner), { workspace_id: owner.workspaceId, name: "Claude Code", mode: "live" });
    liveKey = live.key;
    liveKeyId = live.id;
    testKey = (await keyActions.create(sql, person(owner), { workspace_id: owner.workspaceId, name: "Sandbox", mode: "test" })).key;
  }, 120_000);

  afterAll(async () => {
    for (const who of [owner, stranger].filter(Boolean)) {
      await api(target.baseUrl, target.adminKey, "DELETE", `/api/database/records/workspaces?id=eq.${who.workspaceId}`);
      await api(target.baseUrl, target.adminKey, "DELETE", "/api/auth/users", { userIds: [who.userId] });
    }
  }, 60_000);

  it("stores only a hash of each key and shows the full key once", async () => {
    const [stored] = await sql<{ key_hash: string; key_prefix: string }>(`SELECT key_hash, key_prefix FROM public.api_keys WHERE id = $1`, [liveKeyId]);
    expect(stored.key_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.key_hash).not.toContain(liveKey);
    expect(liveKey.startsWith(stored.key_prefix)).toBe(true);
    const listed = await keyActions.list(sql, person(owner), { workspace_id: owner.workspaceId });
    expect(JSON.stringify(listed)).not.toContain(liveKey);
    expect(listed.keys.map((k) => k.name).sort()).toEqual(["Claude Code", "Sandbox"]);
    await expect(keyActions.list(sql, person(stranger), { workspace_id: owner.workspaceId })).rejects.toThrow(/not found/);
  });

  it("tells a key who it acts for and lists the workspace's accounts", async () => {
    const me = await call(liveKey, "GET", "/v1/me");
    expect(me.body).toMatchObject({ workspace: { id: owner.workspaceId }, key: { name: "Claude Code", mode: "live" } });
    const accounts = await call(liveKey, "GET", "/v1/accounts");
    expect(accounts.body.accounts).toEqual([expect.objectContaining({ id: facebook, platform: "facebook" })]);
    expect(accounts.body.accounts[0]).not.toHaveProperty("approval");
    const [used] = await sql<{ n: string }>(`SELECT count(*)::text AS n FROM public.usage_events WHERE workspace_id = $1 AND event_type = 'api_call'`, [owner.workspaceId]);
    expect(Number(used.n)).toBeGreaterThanOrEqual(2);
  });

  it("an AI's post goes out as directed", async () => {
    const created = await call(liveKey, "POST", "/v1/posts", textPost(`Now from the API ${suffix}`));
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ status: "processing", next_step: expect.stringMatching(/^Publishing now/) });
    const at = new Date(Date.now() + 2 * 3600_000).toISOString();
    const later = await call(liveKey, "POST", "/v1/posts", textPost(`Later from the API ${suffix}`, { scheduled_at: at }));
    expect(later.body).toMatchObject({ status: "scheduled", next_step: `Scheduled for ${at}.` });
  });

  it("an account set to ask first holds an AI's post, and the AI cannot approve it", async () => {
    await sql(`UPDATE public.connected_accounts SET approval_policy_override = 'confirm_each' WHERE id = $1`, [facebook]);
    const created = await call(liveKey, "POST", "/v1/posts", textPost(`From the API ${suffix}`));
    await sql(`UPDATE public.connected_accounts SET approval_policy_override = NULL WHERE id = $1`, [facebook]);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ status: "awaiting_approval", next_step: expect.stringMatching(/approval/) });
    const keyCaller = (await callerForKey(sql, liveKey, "api"))!;
    await expect(postActions.approve({ sql }, keyCaller, { post_id: created.body.id })).rejects.toThrow(/Only a person can approve/);
    const [audit] = await sql<{ display_name: string; entry_point: string }>(
      `SELECT a.display_name, e.entry_point FROM public.audit_events e JOIN public.actors a ON a.id = e.actor_id
       WHERE e.entity_id = $1 AND e.event_type = 'post.created'`,
      [created.body.id],
    );
    expect(audit).toEqual({ display_name: "Claude Code", entry_point: "api" });
    const listed = await call(liveKey, "GET", "/v1/posts?status=awaiting_approval");
    expect(listed.body.posts.map((p: { id: string }) => p.id)).toContain(created.body.id);
  });

  it("test keys can make drafts but never publish", async () => {
    const refused = await call(testKey, "POST", "/v1/posts", textPost("Test key post"));
    expect(refused).toMatchObject({ status: 403, body: { error: { code: "forbidden", message: expect.stringMatching(/^Test keys cannot publish/) } } });
    const draft = await call(testKey, "POST", "/v1/posts", textPost("Test key draft", { draft: true }));
    expect(draft.body.status).toBe("draft");
    const publish = await call(testKey, "POST", `/v1/posts/${draft.body.id}/publish`);
    expect(publish.status).toBe(403);
    const deleted = await call(testKey, "DELETE", `/v1/posts/${draft.body.id}`);
    expect(deleted.body).toEqual({ post_id: draft.body.id, deleted: true });
  });

  it("test keys cannot change a post that is already queued to go out", async () => {
    const [queued] = await sql<{ id: string }>(
      `INSERT INTO public.posts (workspace_id, entry_point, caption, effective_approval_policy, status) VALUES ($1, 'ui', 'Queued', 'autonomous', 'scheduled') RETURNING id`,
      [owner.workspaceId],
    );
    const edit = await call(testKey, "PATCH", `/v1/posts/${queued.id}`, { caption: "Changed by a test key" });
    expect(edit.status).toBe(403);
    const [after] = await sql<{ caption: string; status: string }>(`SELECT caption, status FROM public.posts WHERE id = $1`, [queued.id]);
    expect(after).toEqual({ caption: "Queued", status: "scheduled" });
  });

  it("a repeated write with the same Idempotency-Key acts once", async () => {
    const body = textPost(`Once only ${suffix}`, { draft: true });
    const first = await call(liveKey, "POST", "/v1/posts", body, { "Idempotency-Key": `create-${suffix}` });
    const second = await call(liveKey, "POST", "/v1/posts", body, { "Idempotency-Key": `create-${suffix}` });
    expect(second.body.id).toBe(first.body.id);
    expect(second.headers.get("idempotent-replayed")).toBe("true");
    const different = await call(liveKey, "POST", "/v1/posts", textPost("Something else", { draft: true }), { "Idempotency-Key": `create-${suffix}` });
    expect(different.status).toBe(422);
    const [{ n }] = await sql<{ n: string }>(`SELECT count(*)::text AS n FROM public.posts WHERE workspace_id = $1 AND caption = $2`, [owner.workspaceId, `Once only ${suffix}`]);
    expect(n).toBe("1");
  });

  it("keys cannot see or touch another workspace", async () => {
    const [foreign] = await sql<{ id: string }>(
      `INSERT INTO public.posts (workspace_id, entry_point, caption, effective_approval_policy) VALUES ($1, 'ui', 'Private', 'confirm_each') RETURNING id`,
      [stranger.workspaceId],
    );
    expect((await call(liveKey, "GET", `/v1/posts/${foreign.id}`)).status).toBe(404);
    expect((await call(liveKey, "DELETE", `/v1/posts/${foreign.id}`)).status).toBe(404);
    const otherAccount = await call(liveKey, "POST", "/v1/posts", { caption: "x", draft: true, destinations: [{ account_id: crypto.randomUUID(), options: { media_type: "text" } }] });
    expect(otherAccount.status).toBe(400);
  });

  it("serves the same tools over MCP", async () => {
    const init = await mcp(liveKey, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(init.body.result.serverInfo.name).toBe("post-social");
    const result = await mcp(liveKey, "tools/call", { name: "list_social_accounts", arguments: {} });
    expect(result.body.result.isError).toBe(false);
    expect(result.body.result.structuredContent.accounts[0].id).toBe(facebook);
    const bad = await mcp(liveKey, "tools/call", { name: "get_post", arguments: { post_id: "nope" } });
    expect(bad.body.result).toMatchObject({ isError: true, content: [{ text: "Post is missing or not valid." }] });
  });

  it("a revoked key stops working at once, and AIs cannot manage keys", async () => {
    const keyCaller = (await callerForKey(sql, liveKey, "mcp"))!;
    await expect(keyActions.create(sql, keyCaller, { workspace_id: owner.workspaceId, name: "Sneaky", mode: "live" })).rejects.toThrow(/managed by a person/);
    await keyActions.revoke(sql, person(owner), { key_id: liveKeyId });
    expect((await call(liveKey, "GET", "/v1/me")).status).toBe(401);
  });
});

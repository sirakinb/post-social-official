// @vitest-environment node
//
// The publishing engine on the dev database, with stand-in platforms: `npm run test:db`.
// The test workspace has publishing paused, so the shared dev worker never touches it; the
// test runner claims only this workspace's jobs.
import path from "node:path";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSql } from "../lib/insforge-admin";
import { importKey, seal } from "../lib/connections/crypto";
import { postActions } from "../lib/publishing/service";
import type { Caller } from "../lib/access";
import { createAccount, resolveTarget, type AccountResult } from "../../scripts/lib/accounts";
import { runNextPublishJob, type PublishDeps } from "../../worker/src/publish/runner";
import { PublishError, type Adapter } from "../../worker/src/publish/types";
import { api, uniqueSuffix } from "./dev-backend";

const enabled = process.env.INSFORGE_INTEGRATION === "1";
type View = Awaited<ReturnType<typeof postActions.get>>;

describe.skipIf(!enabled)("publishing engine on the dev backend (US-027 to US-030, US-039)", () => {
  const target = enabled ? resolveTarget("dev", path.resolve(__dirname, "../..")) : null!;
  const sql = enabled ? createSql(target.baseUrl, target.adminKey) : null!;
  const suffix = uniqueSuffix();
  const key = randomBytes(32).toString("base64");
  let owner: AccountResult;
  let facebook = "";
  let threads = "";
  let tiktok = "";

  // A stand-in platform that records every real "send".
  const sent: string[] = [];
  let platformMode: "ok" | "flaky" | "refuse" = "ok";
  const posted = new Map<string, string>(); // checkpoint marker -> platform id
  const standIn: Adapter = async (ctx) => {
    if (ctx.checkpoint.publish_started_at) {
      // Resuming: ask the "platform" whether it already has the post.
      const existing = posted.get(ctx.bundle.destinationId);
      if (existing) return { kind: "published", platformId: existing, liveUrl: `https://example.social/${existing}` };
    }
    if (platformMode === "flaky") throw new PublishError("http_503", "The platform is temporarily unavailable.", true);
    if (platformMode === "refuse") throw new PublishError("meta_100", "The platform refused the post: caption has a banned word.");
    await ctx.save({ publish_started_at: new Date().toISOString() });
    const id = `sp-${sent.length + 1}`;
    sent.push(ctx.bundle.destinationId);
    posted.set(ctx.bundle.destinationId, id);
    if (crashAfterSend) {
      crashAfterSend = false;
      // Simulate the worker dying right after the platform accepted the post: nothing else
      // is recorded (lost_job makes the runner stop without writing).
      throw new PublishError("lost_job", "simulated crash", true);
    }
    return { kind: "published", platformId: id, liveUrl: `https://example.social/${id}` };
  };
  let crashAfterSend = false;

  const deps = (): PublishDeps => ({
    sql,
    r2: { presignGet: async () => "https://r2.example/x" } as never,
    setting: (name) => (name === "CREDENTIAL_ENCRYPTION_KEY" ? key : ""),
    adapters: { facebook: standIn, threads: standIn, tiktok: standIn },
    onlyWorkspace: owner.workspaceId,
  });
  const drain = async () => {
    for (let i = 0; i < 20 && (await runNextPublishJob(deps())); i++);
  };

  const person = (): Caller => ({ userId: owner.userId, displayName: "Owner", entryPoint: "ui" });
  const ai = (): Caller => ({ userId: owner.userId, displayName: "Owner", entryPoint: "mcp" });
  const act = (caller: Caller, action: keyof typeof postActions, input: Record<string, unknown>) =>
    postActions[action]({ sql }, caller, input) as Promise<View & { check?: { ok: boolean; problems: string[] } }>;
  const textPost = (accountId: string, caption: string) => ({
    workspace_id: owner.workspaceId,
    caption,
    destinations: [{ account_id: accountId, options: { media_type: "text" } }],
  });

  beforeAll(async () => {
    owner = await createAccount(target, {
      role: "owner", email: `pub-${suffix}@postsocial.test`, displayName: "Owner", password: `Pub-${suffix}-pass-1`, workspaceName: `Publishing Test ${suffix}`,
    });
    await sql(`UPDATE public.workspaces SET publishing_paused = true WHERE id = $1`, [owner.workspaceId]);
    const sealed = await seal({ accessToken: "fake" }, await importKey(key));
    const make = async (platform: string, external: string) => {
      const [row] = await sql<{ id: string }>(
        `WITH a AS (
           INSERT INTO public.connected_accounts (workspace_id, platform, external_account_id, handle, display_name, capabilities)
           VALUES ($1, $2, $3, $3, $4, '{}') RETURNING id
         ), c AS (
           INSERT INTO public.credentials (workspace_id, connected_account_id, encrypted_payload, initialization_vector, key_version)
           SELECT $1, id, $5, $6, 1 FROM a
         ) SELECT id FROM a`,
        [owner.workspaceId, platform, external, `Test ${platform}`, sealed.encryptedPayload, sealed.initializationVector],
      );
      return row.id;
    };
    facebook = await make("facebook", `fb-${suffix}`);
    threads = await make("threads", `th-${suffix}`);
    tiktok = await make("tiktok", `tt-${suffix}`);
  }, 120_000);

  afterAll(async () => {
    if (!owner) return;
    await api(target.baseUrl, target.adminKey, "DELETE", `/api/database/records/workspaces?id=eq.${owner.workspaceId}`);
    await api(target.baseUrl, target.adminKey, "DELETE", "/api/auth/users", { userIds: [owner.userId] });
  }, 60_000);

  it("explains problems before publishing and refuses to submit an invalid post", async () => {
    const check = await act(person(), "validate", { workspace_id: owner.workspaceId, caption: "x".repeat(501), destinations: [{ account_id: threads, options: { media_type: "text" } }] });
    expect(check).toMatchObject({ ok: false });
    expect((check as unknown as { problems: string[] }).problems).toEqual(["Threads (Test threads): Threads posts can be at most 500 characters; this one is 501."]);

    const draft = await act(person(), "create", textPost(threads, "x".repeat(501)));
    expect(draft.status).toBe("draft");
    await expect(act(person(), "submit", { post_id: draft.id })).rejects.toThrow(/can't be published yet\. Threads \(Test threads\): Threads posts can be at most 500/);
  });

  it("a post the person submits goes out right away and records the live link", async () => {
    const draft = await act(person(), "create", textPost(facebook, `Hello from the person ${suffix}`));
    const submitted = await act(person(), "submit", { post_id: draft.id });
    expect(submitted.status).toBe("processing");
    await drain();
    const done = await act(person(), "get", { post_id: draft.id });
    expect(done.status).toBe("published");
    expect(done.destinations[0]).toMatchObject({ status: "published", live_url: expect.stringMatching(/^https:\/\/example\.social\/sp-\d+$/) });
    const [usage] = await sql<{ n: string }>(`SELECT sum(quantity)::text AS n FROM public.usage_events WHERE workspace_id = $1 AND event_type = 'post_published'`, [owner.workspaceId]);
    expect(Number(usage.n)).toBe(1);
  });

  it("an AI's post waits for approval; approving publishes it", async () => {
    const draft = await act(ai(), "create", textPost(facebook, `From the AI ${suffix}`));
    const submitted = await act(ai(), "submit", { post_id: draft.id });
    expect(submitted.status).toBe("awaiting_approval");
    expect(submitted.approval).toMatchObject({ status: "pending" });
    await drain();
    expect((await act(person(), "get", { post_id: draft.id })).status).toBe("awaiting_approval");

    await act(person(), "approve", { post_id: draft.id, note: "Looks good" });
    await drain();
    expect((await act(person(), "get", { post_id: draft.id })).status).toBe("published");
    const audit = await sql<{ event_type: string; entry_point: string }>(`SELECT event_type, entry_point FROM public.audit_events WHERE entity_id = $1 ORDER BY occurred_at`, [draft.id]);
    expect(audit.map((a) => `${a.entry_point}:${a.event_type}`)).toEqual(["mcp:post.created", "mcp:post.submitted", "ui:post.approved"]);
  });

  it("autonomous accounts publish an AI's post without approval, except on TikTok", async () => {
    await sql(`UPDATE public.connected_accounts SET approval_policy_override = 'autonomous' WHERE id IN ($1, $2)`, [threads, tiktok]);
    const auto = await act(ai(), "submit", { post_id: (await act(ai(), "create", textPost(threads, `Autonomous ${suffix}`))).id });
    expect(auto.status).toBe("processing");

    const tt = await act(ai(), "create", {
      workspace_id: owner.workspaceId, caption: "TikTok from AI", destinations: [{ account_id: tiktok, options: { delivery_mode: "inbox" } }], media_ids: [],
    });
    // (No video attached, so the check fails; the approval rule is what matters here.)
    await expect(act(ai(), "submit", { post_id: tt.id })).rejects.toThrow(/TikTok draft needs exactly 1 video/);
    await drain();
  });

  it("rejecting sends an AI's post back to draft", async () => {
    const draft = await act(ai(), "create", textPost(facebook, `Reject me ${suffix}`));
    await act(ai(), "submit", { post_id: draft.id });
    const rejected = await act(person(), "reject", { post_id: draft.id, note: "Not this week" });
    expect(rejected.status).toBe("draft");
    expect(rejected.approval).toMatchObject({ status: "decided" });
  });

  it("schedules, reschedules and cancels before the job starts", async () => {
    const at = new Date(Date.now() + 3600_000).toISOString();
    const draft = await act(person(), "create", { ...textPost(facebook, `Scheduled ${suffix}`), scheduled_at: at });
    const scheduled = await act(person(), "submit", { post_id: draft.id });
    expect(scheduled.status).toBe("scheduled");
    expect(scheduled.destinations[0].status).toBe("scheduled");
    await drain();
    expect((await act(person(), "get", { post_id: draft.id })).status).toBe("scheduled"); // not due yet

    const later = new Date(Date.now() + 7200_000).toISOString();
    await act(person(), "reschedule", { post_id: draft.id, scheduled_at: later });
    const [job] = await sql<{ next_attempt_at: string }>(`SELECT next_attempt_at FROM public.publish_jobs WHERE post_id = $1`, [draft.id]);
    expect(Date.parse(job.next_attempt_at)).toBe(Date.parse(later));

    const cancelled = await act(person(), "cancel", { post_id: draft.id });
    expect(cancelled.status).toBe("cancelled");
    const [after] = await sql<{ state: string }>(`SELECT state FROM public.publish_jobs WHERE post_id = $1`, [draft.id]);
    expect(after.state).toBe("cancelled");
  });

  it("editing a scheduled post that needed approval takes it out of the queue and back to approval", async () => {
    const at = new Date(Date.now() + 3600_000).toISOString();
    const draft = await act(ai(), "create", { ...textPost(facebook, `Edit me ${suffix}`), scheduled_at: at });
    await act(ai(), "submit", { post_id: draft.id });
    await act(person(), "approve", { post_id: draft.id });
    expect((await act(person(), "get", { post_id: draft.id })).status).toBe("scheduled");

    const edited = await act(ai(), "update", { post_id: draft.id, caption: `Edited caption ${suffix}` });
    expect(edited.status).toBe("awaiting_approval");
    expect(edited.approval).toMatchObject({ status: "pending" });
    const states = await sql<{ state: string }>(`SELECT state FROM public.publish_jobs WHERE post_id = $1`, [draft.id]);
    expect(states.map((s) => s.state)).toEqual(["cancelled"]);
  });

  it("adding an account to an approved autonomous post cannot skip approval", async () => {
    await sql(`UPDATE public.connected_accounts SET approval_policy_override = 'autonomous' WHERE id = $1`, [threads]);
    await sql(`UPDATE public.connected_accounts SET approval_policy_override = NULL WHERE id = $1`, [facebook]);
    const at = new Date(Date.now() + 3600_000).toISOString();
    const draft = await act(ai(), "create", { ...textPost(threads, `Autonomous scheduled ${suffix}`), scheduled_at: at });
    expect((await act(ai(), "submit", { post_id: draft.id })).status).toBe("scheduled");

    // The AI adds an "ask me first" account to the queued post.
    const edited = await act(ai(), "update", {
      post_id: draft.id,
      destinations: [
        { account_id: threads, options: { media_type: "text" } },
        { account_id: facebook, options: { media_type: "text" } },
      ],
    });
    expect(edited.status).toBe("awaiting_approval");
    expect(edited.approval).toMatchObject({ status: "pending" });
    await act(person(), "cancel", { post_id: draft.id });
  });

  it("retries temporary errors with backoff, then fails with a plain reason", async () => {
    platformMode = "flaky";
    const draft = await act(person(), "create", textPost(facebook, `Flaky ${suffix}`));
    await act(person(), "submit", { post_id: draft.id });
    await drain();
    let [job] = await sql<{ state: string; attempt_count: number; next_attempt_at: string }>(`SELECT state, attempt_count, next_attempt_at FROM public.publish_jobs WHERE post_id = $1`, [draft.id]);
    expect(job).toMatchObject({ state: "retry_wait", attempt_count: 1 });
    expect(Date.parse(job.next_attempt_at)).toBeGreaterThan(Date.now() + 20_000);

    platformMode = "refuse";
    await sql(`UPDATE public.publish_jobs SET next_attempt_at = now() WHERE post_id = $1`, [draft.id]);
    await drain();
    [job] = await sql(`SELECT state, attempt_count, next_attempt_at FROM public.publish_jobs WHERE post_id = $1`, [draft.id]);
    expect(job.state).toBe("failed");
    const final = await act(person(), "get", { post_id: draft.id });
    expect(final.status).toBe("failed");
    expect(final.destinations[0]).toMatchObject({ status: "failed", error_code: "meta_100", error_message: "The platform refused the post: caption has a banned word." });
    platformMode = "ok";
  });

  it("never posts twice when the worker dies right after the platform accepted the post", async () => {
    const before = sent.length;
    const draft = await act(person(), "create", textPost(facebook, `Crash test ${suffix}`));
    await act(person(), "submit", { post_id: draft.id });
    crashAfterSend = true;
    await runNextPublishJob(deps()); // sends, then "dies" before recording anything
    expect(sent.length).toBe(before + 1);
    expect((await act(person(), "get", { post_id: draft.id })).destinations[0].status).toBe("processing");

    // The lease runs out; another worker picks the job up.
    await sql(`UPDATE public.publish_jobs SET lease_expires_at = now() - interval '1 second' WHERE post_id = $1`, [draft.id]);
    await drain();
    expect(sent.length).toBe(before + 1); // not sent again
    const done = await act(person(), "get", { post_id: draft.id });
    expect(done.status).toBe("published");
  });

  it("two workers never take the same job", async () => {
    const before = sent.length;
    const draft = await act(person(), "create", textPost(facebook, `Race ${suffix}`));
    await act(person(), "submit", { post_id: draft.id });
    await Promise.all([runNextPublishJob(deps()), runNextPublishJob(deps()), runNextPublishJob(deps())]);
    await drain();
    expect(sent.length).toBe(before + 1);
    expect((await act(person(), "get", { post_id: draft.id })).status).toBe("published");
  });

  it("refuses accounts outside the dev allowlist", async () => {
    const draft = await act(person(), "create", textPost(facebook, `Allowlist ${suffix}`));
    await act(person(), "submit", { post_id: draft.id });
    for (let i = 0; i < 5 && (await runNextPublishJob({ ...deps(), allowlist: ["someone-else"] })); i++);
    const done = await act(person(), "get", { post_id: draft.id });
    expect(done.destinations[0]).toMatchObject({ status: "failed", error_code: "not_allowlisted" });
  });

  it("does not let reviewers or outsiders change posts", async () => {
    const outsider: Caller = { userId: "00000000-0000-0000-0000-000000000000", displayName: "x", entryPoint: "ui" };
    const draft = await act(person(), "create", textPost(facebook, `Private ${suffix}`));
    await expect(act(outsider, "get", { post_id: draft.id })).rejects.toThrow("That post was not found.");
  });
});

// @vitest-environment node
//
// Connections against the dev database with a stand-in for the platforms (their sign-in
// pages cannot be automated): `npm run test:db`. Skipped by `npm test`.
import path from "node:path";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createConnectionsHandler } from "../functions/connections/handler";
import { createSql } from "../lib/insforge-admin";
import { importKey, open, sha256Hex } from "../lib/connections/crypto";
import { refreshDueTokens } from "../../worker/src/tokens";
import { createAccount, resolveTarget, type AccountResult } from "../../scripts/lib/accounts";
import { api, uniqueSuffix } from "./dev-backend";

const enabled = process.env.INSFORGE_INTEGRATION === "1";

type Row = Record<string, unknown>;

describe.skipIf(!enabled)("connections on the dev backend (US-016, US-025, US-026)", () => {
  const target = enabled ? resolveTarget("dev", path.resolve(__dirname, "../..")) : null!;
  const sql = enabled ? createSql(target.baseUrl, target.adminKey) : null!;
  const suffix = uniqueSuffix();
  const password = `Conn-${suffix}-9`;
  const encryptionKey = randomBytes(32).toString("base64");
  const metaSecret = `meta-test-secret-${suffix}`;
  const created: AccountResult[] = [];
  const tokens: Record<string, string> = {};
  const igUserId = `ig-${suffix}`;
  const metaUserId = `meta-user-${suffix}`;
  const platformCalls: string[] = [];
  let platformMode: "ok" | "refuse" = "ok";

  // Stand-in for Instagram and Facebook.
  const http = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    platformCalls.push(`${init?.method ?? "GET"} ${url.split("?")[0]}`);
    const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (platformMode === "refuse") return reply({ error: { message: "Session has expired", code: 190 } }, 400);
    if (url.includes("api.instagram.com/oauth/access_token")) return reply({ access_token: "ig-short", user_id: igUserId });
    if (url.includes("graph.instagram.com/access_token")) return reply({ access_token: `ig-long-${suffix}`, expires_in: 60 });
    if (url.includes("graph.instagram.com/refresh_access_token")) return reply({ access_token: `ig-refreshed-${suffix}`, expires_in: 5184000 });
    if (url.includes("graph.instagram.com/v25.0/me")) return reply({ id: igUserId, username: "test_ig", name: "Test IG", profile_picture_url: "https://cdn.example/a.jpg" });
    if (url.includes("me/permissions")) return reply({ success: true });
    if (url.includes("graph.facebook.com") && url.includes("fb_exchange_token")) return reply({ access_token: "fb-user-long" });
    if (url.includes("graph.facebook.com") && url.includes("oauth/access_token")) return reply({ access_token: "fb-short" });
    if (url.includes("graph.facebook.com/v25.0/me/accounts")) return reply({ data: [{ id: `page-${suffix}`, name: "Test Page", access_token: "page-token", tasks: ["CREATE_CONTENT"] }] });
    if (url.includes("graph.facebook.com/v25.0/me")) return reply({ id: metaUserId });
    return reply({ error: { message: `unexpected ${url}` } }, 500);
  }) as typeof fetch;

  const settings: Record<string, string> = {
    INSTAGRAM_APP_ID: "ig-app", INSTAGRAM_APP_SECRET: "ig-secret", META_APP_ID: "fb-app", META_APP_SECRET: "fb-secret", META_LOGIN_CONFIG_ID: "cfg",
    CONNECTIONS_BASE_URL: "https://fn.example/connections", CREDENTIAL_ENCRYPTION_KEY: encryptionKey, GOOGLE_REDIRECT_URI: "http://localhost:3333/oauth/youtube/callback",
  };
  const handler = enabled
    ? createConnectionsHandler({
        sql,
        setting: (name) => settings[name] ?? (() => { throw new Error(`missing ${name}`); })(),
        allowedReturnOrigins: ["http://localhost:3333"],
        http,
        userForToken: async (token) => {
          const entry = Object.entries(tokens).find(([, value]) => value === token);
          return entry ? { id: entry[0], email: `${entry[0]}@test`, name: "Tester" } : null;
        },
        webAppHome: "http://localhost:3333/beta/accounts",
        metaAppSecrets: ["other-app-secret", metaSecret],
        selfBaseUrl: "https://fn.example/connections",
      })
    : null!;

  const call = (method: string, pathName: string, body?: unknown, token?: string) =>
    handler(new Request(`https://fn.example${pathName}`, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }));

  const starters = new Map<string, AccountResult>();
  async function start(platform: string, owner: AccountResult) {
    const response = await call("POST", "/start", { workspace_id: owner.workspaceId, platform, return_to: "http://localhost:3333/beta/accounts?workspace=x" }, tokens[owner.userId]);
    expect(response.status).toBe(200);
    const state = new URL(((await response.json()) as { url: string }).url).searchParams.get("state")!;
    starters.set(state, owner);
    return state;
  }

  // The platform's callback only forwards the browser to the web app's finish page, which
  // finishes the sign-in as the signed-in person (by default, whoever started it). Returns
  // where the person ends up, like the web app's /beta/connect/finish route.
  async function callback(platform: string, state: string, extra = "code=abc", signedInAs?: AccountResult) {
    const response = await call("GET", `/oauth/${platform}/callback?state=${encodeURIComponent(state)}&${extra}`);
    expect(response.status).toBe(302);
    const next = new URL(response.headers.get("location")!);
    if (next.pathname !== "/beta/connect/finish") return next; // nothing to finish
    expect(next.origin).toBe("http://localhost:3333");
    expect(next.searchParams.get("platform")).toBe(platform);
    const person = signedInAs ?? starters.get(state)!;
    const params = Object.fromEntries([...next.searchParams].filter(([key]) => key !== "platform"));
    const finished = await call("POST", "/complete", { platform, params }, tokens[person.userId]);
    expect(finished.status).toBe(200);
    const result = (await finished.json()) as { ok: boolean; returnTo: string | null; message: string; platform: string };
    const target = new URL(result.returnTo ?? "http://localhost:3333/beta/accounts");
    if (result.ok) {
      target.searchParams.set("connected", result.platform);
      target.searchParams.set("message", result.message);
    } else target.searchParams.set("error", result.message);
    return target;
  }

  let ownerA: AccountResult;
  let ownerB: AccountResult;
  let reviewer: AccountResult;

  beforeAll(async () => {
    const make = async (label: string, extra: Partial<Parameters<typeof createAccount>[1]> = {}) => {
      const result = await createAccount(target, {
        role: "owner", email: `conn-${label}-${suffix}@postsocial.test`, displayName: `Conn ${label}`, password, workspaceName: `Conn ${label} ${suffix}`, ...extra,
      } as Parameters<typeof createAccount>[1]);
      created.push(result);
      tokens[result.userId] = `token-${result.userId}`;
      return result;
    };
    ownerA = await make("a");
    ownerB = await make("b");
    reviewer = await make("r", { role: "reviewer", workspaceSlug: ownerA.workspaceSlug } as never);
  }, 120_000);

  afterAll(async () => {
    const ids = [...new Set(created.map((c) => c.workspaceId))];
    if (ids.length) expect((await api(target.baseUrl, target.adminKey, "DELETE", `/api/database/records/workspaces?id=in.(${ids.join(",")})`)).status).toBeLessThan(300);
    if (created.length) expect((await api(target.baseUrl, target.adminKey, "DELETE", "/api/auth/users", { userIds: created.map((c) => c.userId) })).status).toBeLessThan(300);
    await sql(`DELETE FROM public.data_deletion_requests WHERE external_user_hash = $1`, [await sha256Hex(metaUserId)]);
  }, 120_000);

  it("connects Instagram: encrypted tokens, connected health, capabilities and an audit entry", async () => {
    const back = await callback("instagram", await start("instagram", ownerA));
    expect(back.searchParams.get("connected")).toBe("instagram");
    expect(back.searchParams.get("message")).toBe("Connected Test IG.");
    const [account] = await sql<Row>(`SELECT * FROM public.connected_accounts WHERE workspace_id = $1 AND platform = 'instagram'`, [ownerA.workspaceId]);
    expect(account).toMatchObject({ external_account_id: igUserId, handle: "test_ig", health: "connected" });
    expect((account.capabilities as { post_types: string[] }).post_types).toEqual(["image", "reel", "carousel"]);

    const [credential] = await sql<{ encrypted_payload: string; initialization_vector: string }>(`SELECT * FROM public.credentials WHERE connected_account_id = $1`, [account.id]);
    expect(credential.encrypted_payload).not.toContain("ig-long");
    expect(await open({ encryptedPayload: credential.encrypted_payload, initializationVector: credential.initialization_vector }, await importKey(encryptionKey))).toEqual({ accessToken: `ig-long-${suffix}` });

    const audit = await sql<{ event_type: string }>(`SELECT event_type FROM public.audit_events WHERE entity_id = $1`, [account.id]);
    expect(audit.map((a) => a.event_type)).toEqual(["account.connected"]);
  });

  it("uses each sign-in state once, and refuses unknown ones", async () => {
    const state = await start("instagram", ownerA);
    expect((await callback("instagram", state)).searchParams.get("connected")).toBe("instagram");
    expect((await callback("instagram", state)).searchParams.get("error")).toMatch(/expired|already used/);
    expect((await callback("instagram", "made-up")).searchParams.get("error")).toMatch(/expired|already used/);
  });

  it("reconnecting updates the same account instead of adding a duplicate", async () => {
    const accounts = await sql(`SELECT id FROM public.connected_accounts WHERE workspace_id = $1 AND platform = 'instagram'`, [ownerA.workspaceId]);
    expect(accounts).toHaveLength(1);
    const audit = await sql<{ event_type: string }>(`SELECT event_type FROM public.audit_events WHERE entity_id = $1 ORDER BY occurred_at`, [(accounts[0] as Row).id]);
    expect(audit.map((a) => a.event_type)).toEqual(["account.connected", "account.reconnected"]);
  });

  it("refuses an account that is already connected to another workspace", async () => {
    const back = await callback("instagram", await start("instagram", ownerB));
    expect(back.searchParams.get("error")).toMatch(/already connected to another workspace/);
  });

  it("a sign-in link sent to someone else can't attach their account to the sender's workspace", async () => {
    const state = await start("instagram", ownerA);
    // ownerB (signed in as themselves) approves ownerA's link: refused, and nothing changes.
    const hijack = await callback("instagram", state, "code=abc", ownerB);
    expect(hijack.searchParams.get("error")).toMatch(/started by someone else/);
    // The request wasn't used up, so the person who started it can still finish it.
    expect((await callback("instagram", state)).searchParams.get("connected")).toBe("instagram");
    // Finishing needs a signed-in person at all.
    expect((await call("POST", "/complete", { platform: "instagram", params: { state, code: "abc" } })).status).toBe(401);
  });

  it("shows a plain message when the person declines on the platform", async () => {
    const back = await callback("instagram", await start("instagram", ownerA), "error=access_denied&error_description=User%20denied");
    expect(back.searchParams.get("error")).toBe("Instagram did not grant access: User denied");
  });

  it("does not let reviewers connect or disconnect", async () => {
    const response = await call("POST", "/start", { workspace_id: ownerA.workspaceId, platform: "instagram" }, tokens[reviewer.userId]);
    expect(response.status).toBe(403);
  });

  it("rejects return addresses outside the web app", async () => {
    const response = await call("POST", "/start", { workspace_id: ownerA.workspaceId, platform: "instagram", return_to: "https://evil.example/" }, tokens[ownerA.userId]);
    expect(response.status).toBe(400);
  });

  it("refreshes tokens close to expiry, and flags the account when the platform refuses", async () => {
    // The stand-in issued a token that expires in 60 seconds, so it is due.
    const [before] = await sql<{ id: string; access_token_expires_at: string }>(
      `SELECT c.id, c.access_token_expires_at FROM public.credentials c JOIN public.connected_accounts a ON a.id = c.connected_account_id
       WHERE a.workspace_id = $1 AND a.platform = 'instagram'`,
      [ownerA.workspaceId],
    );
    const tokenDeps = { sql, setting: (n: string) => settings[n], http };
    expect(await refreshDueTokens(tokenDeps)).toBeGreaterThanOrEqual(1);
    const [after] = await sql<{ encrypted_payload: string; initialization_vector: string; access_token_expires_at: string }>(`SELECT * FROM public.credentials WHERE id = $1`, [before.id]);
    expect(Date.parse(after.access_token_expires_at)).toBeGreaterThan(Date.parse(before.access_token_expires_at));
    expect((await open({ encryptedPayload: after.encrypted_payload, initializationVector: after.initialization_vector }, await importKey(encryptionKey))).accessToken).toBe(`ig-refreshed-${suffix}`);

    await sql(`UPDATE public.credentials SET access_token_expires_at = now() - interval '1 minute' WHERE id = $1`, [before.id]);
    platformMode = "refuse";
    try {
      await refreshDueTokens(tokenDeps);
    } finally {
      platformMode = "ok";
    }
    const [account] = await sql<Row>(`SELECT health, health_reason, id FROM public.connected_accounts WHERE workspace_id = $1 AND platform = 'instagram'`, [ownerA.workspaceId]);
    expect(account).toMatchObject({ health: "needs_attention", health_reason: "Instagram access expired. Reconnect this account to keep posting." });
    const audit = await sql<{ event_type: string }>(`SELECT event_type FROM public.audit_events WHERE entity_id = $1 AND event_type = 'account.refresh_failed'`, [account.id]);
    expect(audit).toHaveLength(1);
  });

  it("disconnecting revokes at the platform, removes tokens and cancels pending posts", async () => {
    const [account] = await sql<{ id: string }>(`SELECT id FROM public.connected_accounts WHERE workspace_id = $1 AND platform = 'instagram'`, [ownerA.workspaceId]);
    const [post] = await sql<{ id: string }>(
      `INSERT INTO public.posts (workspace_id, entry_point, caption, status, effective_approval_policy) VALUES ($1, 'ui', 'hi', 'scheduled', 'confirm_each') RETURNING id`,
      [ownerA.workspaceId],
    );
    await sql(`INSERT INTO public.destinations (workspace_id, post_id, connected_account_id, platform, status, effective_approval_policy) VALUES ($1, $2, $3, 'instagram', 'scheduled', 'confirm_each')`, [ownerA.workspaceId, post.id, account.id]);

    platformCalls.length = 0;
    const response = await call("POST", "/disconnect", { account_id: account.id }, tokens[ownerA.userId]);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "disconnected", revoked: "confirmed", cancelled_destinations: 1 });
    expect(platformCalls).toContain("DELETE https://graph.instagram.com/me/permissions");

    expect(await sql(`SELECT id FROM public.credentials WHERE connected_account_id = $1`, [account.id])).toEqual([]);
    const [statuses] = await sql<Row>(
      `SELECT a.health, p.status AS post_status, (SELECT status FROM public.destinations WHERE post_id = p.id) AS destination_status
       FROM public.connected_accounts a, public.posts p WHERE a.id = $1 AND p.id = $2`,
      [account.id, post.id],
    );
    expect(statuses).toEqual({ health: "disconnected", post_status: "cancelled", destination_status: "cancelled" });

    // An outsider cannot disconnect someone else's account.
    expect((await call("POST", "/disconnect", { account_id: account.id }, tokens[ownerB.userId])).status).toBe(404);
  });

  it("handles Meta deauthorize and data deletion with verified signed requests", async () => {
    // Connect a Facebook Page owned by the Meta user.
    expect((await callback("facebook", await start("facebook", ownerA))).searchParams.get("connected")).toBe("facebook");

    const sign = async (payload: object, secret: string) => {
      const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
      const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const signature = Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encoded))).toString("base64url");
      return `${signature}.${encoded}`;
    };
    const post = (pathName: string, signed: string) =>
      handler(new Request(`https://fn.example${pathName}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ signed_request: signed }) }));

    const forged = await post("/meta/data-deletion", await sign({ algorithm: "HMAC-SHA256", user_id: metaUserId }, "wrong-secret"));
    expect(forged.status).toBe(400);

    const deauth = await post("/meta/deauthorize", await sign({ algorithm: "HMAC-SHA256", user_id: metaUserId }, metaSecret));
    expect(await deauth.json()).toEqual({ success: true, disconnected_accounts: 1 });
    const [page] = await sql<Row>(`SELECT health FROM public.connected_accounts WHERE external_account_id = $1`, [`page-${suffix}`]);
    expect(page.health).toBe("disconnected");

    const deletion = await post("/meta/data-deletion", await sign({ algorithm: "HMAC-SHA256", user_id: metaUserId }, metaSecret));
    const receipt = (await deletion.json()) as { url: string; confirmation_code: string };
    expect(receipt.url).toBe(`https://fn.example/connections/meta/data-deletion/status?code=${receipt.confirmation_code}`);
    expect(await sql(`SELECT id FROM public.connected_accounts WHERE owner_external_id = $1`, [metaUserId])).toEqual([]);

    const status = await call("GET", `/meta/data-deletion/status?code=${receipt.confirmation_code}`);
    expect(await status.json()).toMatchObject({ status: "completed", removed_accounts: 1 });
  });

  it("the deployed dev function builds real sign-in links with its own keys", async () => {
    const session = await api<{ accessToken: string }>(target.baseUrl, "", "POST", "/api/auth/sessions?client_type=server", { email: `conn-a-${suffix}@postsocial.test`, password });
    const response = await fetch("https://syydd6ck-zqc.function2.insforge.app/connections/start", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.body.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ workspace_id: ownerA.workspaceId, platform: "threads", return_to: "http://localhost:3333/beta/accounts" }),
    });
    expect(response.status).toBe(200);
    const url = new URL(((await response.json()) as { url: string }).url);
    expect(url.origin).toBe("https://threads.net");
    expect(url.searchParams.get("redirect_uri")).toBe("https://syydd6ck-zqc.function2.insforge.app/connections/oauth/threads/callback");
    expect(url.searchParams.get("client_id")).toMatch(/^\d+$/);
  });
});

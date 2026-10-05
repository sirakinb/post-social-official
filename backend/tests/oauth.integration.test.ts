// @vitest-environment node
//
// OAuth sign-in for AI apps on the dev database: `npm run test:db`. Runs the whole flow an
// app like ChatGPT or the Claude app goes through, against the real `api` function code.
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSql } from "../lib/insforge-admin";
import { callerForKey } from "../lib/api/keys";
import { callerForAccessToken } from "../lib/oauth/server";
import { createApiHandler } from "../functions/api/handler";
import { createAccount, resolveTarget, type AccountResult } from "../../scripts/lib/accounts";
import { api, uniqueSuffix } from "./dev-backend";

const enabled = process.env.INSFORGE_INTEGRATION === "1";
const ISSUER = "http://localhost:3333";
const REDIRECT = "https://app.example/oauth/callback";

describe.skipIf(!enabled)("OAuth sign-in for AI apps on the dev backend (US-042)", () => {
  const target = enabled ? resolveTarget("dev", path.resolve(__dirname, "../..")) : null!;
  const sql = enabled ? createSql(target.baseUrl, target.adminKey) : null!;
  const suffix = uniqueSuffix();
  let owner: AccountResult;
  let reviewerUser: AccountResult;
  let signedIn: { id: string; email: string; name: string } | null = null;
  let clientId = "";

  const handler = () =>
    createApiHandler({
      sql,
      r2: {} as never,
      newId: () => crypto.randomUUID(),
      webAppUrl: ISSUER,
      publicApiUrl: `${ISSUER}/api`,
      callerForKey,
      callerForAccessToken,
      userForToken: async () => signedIn,
      allowedOrigins: [],
    });
  const send = async (method: string, url: string, body?: unknown, headers: Record<string, string> = {}, form = false) => {
    const response = await handler()(
      new Request(`https://fn${url}`, {
        method,
        headers: { "Content-Type": form ? "application/x-www-form-urlencoded" : "application/json", ...headers },
        body: body === undefined ? undefined : form ? new URLSearchParams(body as Record<string, string>).toString() : JSON.stringify(body),
      }),
    );
    return { status: response.status, headers: response.headers, body: (await response.json().catch(() => null)) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const pkce = () => {
    const verifier = randomBytes(32).toString("base64url");
    return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
  };
  const authParams = (challenge: string, state = "s1") => ({
    response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", state, resource: `${ISSUER}/mcp`,
  });
  // Signs in as `who`, approves the app for their workspace, and returns the code.
  const approve = async (who: AccountResult, challenge: string) => {
    signedIn = { id: who.userId, email: "x@postsocial.test", name: "Person" };
    const decided = await send("POST", "/oauth/consent", { action: "decide", params: authParams(challenge), workspace_id: who.workspaceId, approve: true }, { Authorization: "Bearer session" });
    const back = new URL(decided.body.redirect);
    expect(back.origin + back.pathname).toBe(REDIRECT);
    expect(back.searchParams.get("state")).toBe("s1");
    expect(back.searchParams.get("iss")).toBe(ISSUER);
    return back.searchParams.get("code")!;
  };
  const exchange = (code: string, verifier: string) =>
    send("POST", "/oauth/token", { grant_type: "authorization_code", code, code_verifier: verifier, client_id: clientId, redirect_uri: REDIRECT, resource: `${ISSUER}/mcp` }, {}, true);
  const mcp = (token: string, method: string, params?: unknown) => send("POST", "/mcp", { jsonrpc: "2.0", id: 1, method, params }, { Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    owner = await createAccount(target, { role: "owner", email: `oauth-${suffix}@postsocial.test`, displayName: "Owner", password: `Oauth-${suffix}-pass-1`, workspaceName: `OAuth Test ${suffix}` });
    reviewerUser = await createAccount(target, { role: "owner", email: `oauth-rev-${suffix}@postsocial.test`, displayName: "Rev", password: `Oauth-${suffix}-pass-2`, workspaceName: `OAuth Rev ${suffix}` });
    await sql(`UPDATE public.workspaces SET publishing_paused = true WHERE id = ANY($1::uuid[])`, [[owner.workspaceId, reviewerUser.workspaceId]]);
    // The second person is only a reviewer in the first workspace.
    await sql(`INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'reviewer')`, [owner.workspaceId, reviewerUser.userId]);
  }, 120_000);

  afterAll(async () => {
    for (const who of [owner, reviewerUser].filter(Boolean)) {
      await api(target.baseUrl, target.adminKey, "DELETE", `/api/database/records/workspaces?id=eq.${who.workspaceId}`);
      await api(target.baseUrl, target.adminKey, "DELETE", "/api/auth/users", { userIds: [who.userId] });
    }
    if (clientId) await sql(`DELETE FROM public.oauth_clients WHERE client_id = $1`, [clientId]);
  }, 60_000);

  it("tells an app where to sign in", async () => {
    const denied = await send("POST", "/mcp", { jsonrpc: "2.0", id: 1, method: "initialize" });
    expect(denied.status).toBe(401);
    expect(denied.headers.get("www-authenticate")).toContain(`resource_metadata="${ISSUER}/.well-known/oauth-protected-resource/mcp"`);
    const resource = await send("GET", "/.well-known/oauth-protected-resource/mcp");
    expect(resource.body.authorization_servers).toEqual([ISSUER]);
    const server = await send("GET", "/.well-known/oauth-authorization-server");
    expect(server.body.registration_endpoint).toBe(`${ISSUER}/oauth/register`);
  });

  it("registers an app and refuses unsafe redirect addresses", async () => {
    const bad = await send("POST", "/oauth/register", { client_name: "Bad", redirect_uris: ["http://evil.example/cb"] });
    expect(bad).toMatchObject({ status: 400, body: { error: "invalid_redirect_uri" } });
    const registered = await send("POST", "/oauth/register", { client_name: `Test AI ${suffix}`, redirect_uris: [REDIRECT], token_endpoint_auth_method: "client_secret_basic" });
    expect(registered.status).toBe(201);
    expect(registered.body).toMatchObject({ token_endpoint_auth_method: "none", redirect_uris: [REDIRECT] });
    clientId = registered.body.client_id;
  });

  it("the consent page checks the request and never redirects to an unregistered address", async () => {
    signedIn = { id: owner.userId, email: "x@postsocial.test", name: "Owner" };
    const { challenge } = pkce();
    const ok = await send("POST", "/oauth/consent", { action: "check", params: authParams(challenge) }, { Authorization: "Bearer session" });
    expect(ok.body).toEqual({ client_name: `Test AI ${suffix}`, client_uri: null, redirect_host: "app.example" });
    const wrongRedirect = await send("POST", "/oauth/consent", { action: "check", params: { ...authParams(challenge), redirect_uri: "https://evil.example/cb" } }, { Authorization: "Bearer session" });
    expect(wrongRedirect).toMatchObject({ status: 400, body: { error: { message: expect.stringMatching(/did not register/) } } });
    const noPkce = await send("POST", "/oauth/consent", { action: "check", params: { ...authParams(challenge), code_challenge_method: "plain" } }, { Authorization: "Bearer session" });
    expect(new URL(noPkce.body.redirect).searchParams.get("error")).toBe("invalid_request");
    const denied = await send("POST", "/oauth/consent", { action: "decide", params: authParams(challenge), workspace_id: owner.workspaceId, approve: false }, { Authorization: "Bearer session" });
    expect(new URL(denied.body.redirect).searchParams.get("error")).toBe("access_denied");
  });

  it("issues tokens only with the right code verifier, and each code works once", async () => {
    const { verifier, challenge } = pkce();
    const code = await approve(owner, challenge);
    expect((await exchange(code, pkce().verifier)).body.error).toBe("invalid_grant");
    // A failed attempt still uses up the code.
    expect((await exchange(code, verifier)).body.error).toBe("invalid_grant");

    const fresh = pkce();
    const code2 = await approve(owner, fresh.challenge);
    const tokens = await exchange(code2, fresh.verifier);
    expect(tokens.status).toBe(200);
    expect(tokens.body).toMatchObject({ token_type: "Bearer", expires_in: 3600, access_token: expect.stringMatching(/^ps_at_/), refresh_token: expect.stringMatching(/^ps_rt_/) });
    expect((await exchange(code2, fresh.verifier)).body.error).toBe("invalid_grant");

    const listed = await mcp(tokens.body.access_token, "tools/call", { name: "get_workspace", arguments: {} });
    expect(listed.body.result.structuredContent).toMatchObject({ workspace: { id: owner.workspaceId } });
    const created = await mcp(tokens.body.access_token, "tools/call", { name: "create_post", arguments: { caption: "x", draft: true, destinations: [] } });
    expect(created.body.result.isError).toBe(true); // no accounts, but it reached the post rules as the app

    const [actor] = await sql<{ kind: string; display_name: string }>(
      `SELECT a.kind, a.display_name FROM public.actors a JOIN public.oauth_grants g ON g.id = a.oauth_grant_id WHERE g.workspace_id = $1`,
      [owner.workspaceId],
    );
    expect(actor).toEqual({ kind: "oauth_grant", display_name: `Test AI ${suffix}` });
  });

  it("refresh tokens rotate, and a stolen old one ends the connection", async () => {
    const { verifier, challenge } = pkce();
    const first = await exchange(await approve(owner, challenge), verifier);
    const refresh = (token: string) => send("POST", "/oauth/token", { grant_type: "refresh_token", refresh_token: token, client_id: clientId }, {}, true);
    const second = await refresh(first.body.refresh_token);
    expect(second.status).toBe(200);
    expect(second.body.refresh_token).not.toBe(first.body.refresh_token);
    // Within the grace period an old token is just refused.
    expect((await refresh(first.body.refresh_token)).body.error).toBe("invalid_grant");
    expect((await mcp(second.body.access_token, "ping")).status).toBe(200);
    // After it, reuse means the token leaked: the whole connection ends.
    await sql(`UPDATE public.oauth_grants SET refresh_rotated_at = now() - interval '5 minutes' WHERE workspace_id = $1`, [owner.workspaceId]);
    expect((await refresh(first.body.refresh_token)).body.error).toBe("invalid_grant");
    expect((await mcp(second.body.access_token, "ping")).status).toBe(401);
    expect((await refresh(second.body.refresh_token)).body.error).toBe("invalid_grant");
  });

  it("signing in again retires the old refresh token without ending the connection", async () => {
    const one = pkce();
    const first = await exchange(await approve(owner, one.challenge), one.verifier);
    const two = pkce();
    const second = await exchange(await approve(owner, two.challenge), two.verifier);
    await sql(`UPDATE public.oauth_grants SET refresh_rotated_at = now() - interval '5 minutes' WHERE workspace_id = $1 AND revoked_at IS NULL`, [owner.workspaceId]);
    const old = await send("POST", "/oauth/token", { grant_type: "refresh_token", refresh_token: first.body.refresh_token, client_id: clientId }, {}, true);
    expect(old.body.error).toBe("invalid_grant");
    expect((await mcp(second.body.access_token, "ping")).status).toBe(200);
  });

  it("an app approved by a reviewer can only read, and stops working when they leave", async () => {
    const { verifier, challenge } = pkce();
    const tokens = await exchange(await approve({ ...reviewerUser, workspaceId: owner.workspaceId }, challenge), verifier);
    const read = await mcp(tokens.body.access_token, "tools/call", { name: "list_posts", arguments: {} });
    expect(read.body.result.isError).toBe(false);
    const write = await mcp(tokens.body.access_token, "tools/call", { name: "import_media", arguments: { url: "https://example.com/a.jpg" } });
    expect(write.body.result).toMatchObject({ isError: true, content: [{ text: expect.stringMatching(/can only read/) }] });
    await sql(`DELETE FROM public.workspace_members WHERE workspace_id = $1 AND user_id = $2`, [owner.workspaceId, reviewerUser.userId]);
    expect((await mcp(tokens.body.access_token, "ping")).status).toBe(401);
  });

  it("disconnecting an app in the web app stops it at once", async () => {
    const { verifier, challenge } = pkce();
    const tokens = await exchange(await approve(owner, challenge), verifier);
    signedIn = { id: owner.userId, email: "x@postsocial.test", name: "Owner" };
    const listed = await send("POST", "/keys", { action: "list_grants", workspace_id: owner.workspaceId }, { Authorization: "Bearer session" });
    const grant = listed.body.grants.find((g: { revoked_at: string | null; user_id: string }) => !g.revoked_at && g.user_id === owner.userId);
    await send("POST", "/keys", { action: "revoke_grant", grant_id: grant.id }, { Authorization: "Bearer session" });
    expect((await mcp(tokens.body.access_token, "ping")).status).toBe(401);
    const revoke = await send("POST", "/oauth/revoke", { token: tokens.body.refresh_token }, {}, true);
    expect(revoke.status).toBe(200);
  });
});

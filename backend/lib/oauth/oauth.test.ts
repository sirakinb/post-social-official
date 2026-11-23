import { describe, expect, it } from "vitest";
import type { Sql } from "../access";
import { authorizationServerMetadata, checkAuthorization, isMetadataClientId, protectedResourceMetadata, readClientMetadata, redirectMatches, redirectUriProblem } from "./server";

describe("OAuth discovery", () => {
  it("points AI apps from the MCP server to this site's sign-in", () => {
    const resource = protectedResourceMetadata("https://www.postsocial.xyz");
    expect(resource).toMatchObject({ resource: "https://www.postsocial.xyz/mcp", authorization_servers: ["https://www.postsocial.xyz"] });
    // The bare address describes the site itself (RFC 9728), so the resource matches it.
    expect(protectedResourceMetadata("https://www.postsocial.xyz", "")).toMatchObject({ resource: "https://www.postsocial.xyz", bearer_methods_supported: ["header"], scopes_supported: ["posts"] });
    const server = authorizationServerMetadata("https://www.postsocial.xyz");
    expect(server).toMatchObject({
      issuer: "https://www.postsocial.xyz",
      authorization_endpoint: "https://www.postsocial.xyz/oauth/authorize",
      token_endpoint: "https://www.postsocial.xyz/oauth/token",
      registration_endpoint: "https://www.postsocial.xyz/oauth/register",
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });
  });
});

describe("redirect addresses", () => {
  it("allows https, localhost and app links, never script or plain-http links", () => {
    expect(redirectUriProblem("https://claude.ai/api/mcp/auth_callback")).toBeNull();
    expect(redirectUriProblem("https://chatgpt.com/connector_platform_oauth_redirect")).toBeNull();
    expect(redirectUriProblem("http://localhost:6274/oauth/callback")).toBeNull();
    expect(redirectUriProblem("http://127.0.0.1:33418/callback")).toBeNull();
    expect(redirectUriProblem("cursor://anysphere.cursor-mcp/oauth/callback")).toBeNull();
    expect(redirectUriProblem("http://evil.example/cb")).toMatch(/only allowed for localhost/);
    expect(redirectUriProblem("javascript:alert(1)")).toMatch(/not allowed/);
    expect(redirectUriProblem("https://ok.example/cb#frag")).toMatch(/fragment/);
    expect(redirectUriProblem("not a url")).toMatch(/not a valid link/);
  });

  it("matches exactly, except that localhost may use any port", () => {
    const registered = ["https://claude.ai/api/mcp/auth_callback", "http://127.0.0.1:1234/callback"];
    expect(redirectMatches(registered, "https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(redirectMatches(registered, "https://claude.ai/api/mcp/auth_callback/")).toBe(false);
    expect(redirectMatches(registered, "https://claude.ai.evil.example/api/mcp/auth_callback")).toBe(false);
    expect(redirectMatches(registered, "http://127.0.0.1:5555/callback")).toBe(true);
    expect(redirectMatches(registered, "http://127.0.0.1:5555/other")).toBe(false);
    expect(redirectMatches(registered, "http://localhost:5555/callback")).toBe(false);
  });
});

describe("apps whose id is a web address", () => {
  const GROK = "https://grok.com/oauth/mcp-client.json";
  const grokDoc = {
    client_id: GROK,
    client_name: "Grok",
    client_uri: "https://grok.com",
    redirect_uris: ["https://grok.com/connectors-oauth-exchange-code/"],
    token_endpoint_auth_method: "none",
  };
  const serve = (body: unknown, status = 200) => async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

  it("only reads files from the AI companies' own domains", () => {
    expect(isMetadataClientId(GROK)).toBe(true);
    expect(isMetadataClientId("https://console.x.ai/oauth/client.json")).toBe(true);
    expect(isMetadataClientId("https://claude.ai/oauth/mcp-client.json")).toBe(true);
    expect(isMetadataClientId("psc_abc123")).toBe(false);
    expect(isMetadataClientId("http://grok.com/oauth/mcp-client.json")).toBe(false);
    expect(isMetadataClientId("https://grok.com/")).toBe(false);
    // Anyone else's address, however public it looks.
    expect(isMetadataClientId("https://evil.example/x.json")).toBe(false);
    expect(isMetadataClientId("https://grok.com.evil.example/x.json")).toBe(false);
    expect(isMetadataClientId("https://notgrok.com/x.json")).toBe(false);
    // This computer and private networks, including the trailing-dot spelling.
    expect(isMetadataClientId("https://localhost/x.json")).toBe(false);
    expect(isMetadataClientId("https://localhost./x.json")).toBe(false);
    expect(isMetadataClientId("https://grok.com./oauth/mcp-client.json")).toBe(false);
    expect(isMetadataClientId("https://127.0.0.1/x.json")).toBe(false);
    expect(isMetadataClientId("https://[::1]/x.json")).toBe(false);
    expect(isMetadataClientId("https://169.254.169.254/latest")).toBe(false);
    expect(isMetadataClientId("https://user:pw@grok.com/x.json")).toBe(false);
    expect(isMetadataClientId("https://grok.com:8443/x.json")).toBe(false);
  });

  it("reads the app's name and return addresses from its file", async () => {
    expect(await readClientMetadata(GROK, serve(grokDoc))).toEqual({
      name: "Grok",
      redirectUris: ["https://grok.com/connectors-oauth-exchange-code/"],
      clientUri: "https://grok.com",
    });
  });

  it("refuses files that don't describe that exact app or ask for unsafe things", async () => {
    expect(await readClientMetadata(GROK, serve({ ...grokDoc, client_id: "https://evil.example/x.json" }))).toBeNull();
    expect(await readClientMetadata(GROK, serve({ ...grokDoc, redirect_uris: ["javascript:alert(1)"] }))).toBeNull();
    expect(await readClientMetadata(GROK, serve({ ...grokDoc, redirect_uris: ["http://evil.example/cb"] }))).toBeNull();
    expect(await readClientMetadata(GROK, serve({ ...grokDoc, token_endpoint_auth_method: "client_secret_basic" }))).toBeNull();
    expect(await readClientMetadata(GROK, serve("not json"))).toBeNull();
    expect(await readClientMetadata(GROK, serve("x".repeat(20_000)))).toBeNull();
    expect(await readClientMetadata(GROK, serve(grokDoc, 404))).toBeNull();
    expect(await readClientMetadata(GROK, async () => { throw new Error("redirected"); })).toBeNull();
  });

  const CHATGPT = "https://chatgpt.com/oauth/client.json";
  const chatgptDoc = {
    client_id: CHATGPT,
    client_name: "ChatGPT",
    redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
    token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
    token_endpoint_auth_method: "private_key_jwt",
  };

  it("accepts ChatGPT metadata that advertises public-client support despite the legacy preference", async () => {
    expect(await readClientMetadata(CHATGPT, serve(chatgptDoc))).toMatchObject({
      name: "ChatGPT",
      redirectUris: chatgptDoc.redirect_uris,
    });
  });

  it.each([["private_key_jwt"], [], "none", ["none", 1], null].map((value) => [value]))(
    "refuses invalid or incompatible explicit method lists (%j)",
    async (methods) => {
      const doc = { ...chatgptDoc, token_endpoint_auth_methods_supported: methods, token_endpoint_auth_method: "none" };
      expect(await readClientMetadata(CHATGPT, serve(doc))).toBeNull();
    },
  );

  it("lets ChatGPT reach consent without relaxing redirect or PKCE checks", async () => {
    const sql = (async (query: string, params: unknown[]) => {
      if (query.startsWith("SELECT")) return [];
      return [{ id: "chatgpt", client_id: params[0], client_name: params[1], redirect_uris: params[2], client_uri: params[3] }];
    }) as Sql;
    const issuer = "https://dev.postsocial.xyz";
    const params = {
      client_id: CHATGPT,
      redirect_uri: chatgptDoc.redirect_uris[0],
      response_type: "code",
      code_challenge: "a".repeat(43),
      code_challenge_method: "S256",
      resource: `${issuer}/mcp`,
    };
    const fetcher = serve(chatgptDoc);
    await expect(checkAuthorization(sql, issuer, params, fetcher)).resolves.toMatchObject({
      client: { client_id: CHATGPT }, redirect: null,
    });
    await expect(checkAuthorization(sql, issuer, { ...params, redirect_uri: `${params.redirect_uri}/` }, fetcher)).rejects.toThrow(/did not register/);
    await expect(checkAuthorization(sql, issuer, { ...params, code_challenge_method: undefined }, fetcher)).rejects.toThrow(/PKCE/);
  });

  it("never follows redirects when reading the file", async () => {
    let init: RequestInit | undefined;
    await readClientMetadata(GROK, async (_url, i) => { init = i; return new Response(JSON.stringify(grokDoc)); });
    expect(init?.redirect).toBe("error");
  });

  it("lets Grok sign in: the app is read once, saved, and checked like a registered one", async () => {
    const saved: unknown[][] = [];
    const sql = (async (query: string, params: unknown[]) => {
      if (query.startsWith("SELECT")) return [];
      saved.push(params);
      return [{ id: "c1", client_id: params[0], client_name: params[1], redirect_uris: params[2], client_uri: params[3] }];
    }) as Sql;
    const params = { client_id: GROK, redirect_uri: "https://grok.com/connectors-oauth-exchange-code/", response_type: "code", code_challenge: "a".repeat(43), code_challenge_method: "S256" };
    const result = await checkAuthorization(sql, "https://www.postsocial.xyz", params, serve(grokDoc));
    expect(result.redirect).toBeNull();
    expect(result.client.client_name).toBe("Grok");
    expect(saved).toHaveLength(1);
  });

  it("still refuses an unknown id that isn't a web address", async () => {
    const sql = (async () => []) as Sql;
    await expect(checkAuthorization(sql, "https://www.postsocial.xyz", { client_id: "psc_nope", redirect_uri: "https://x.example/cb" })).rejects.toThrow(/not registered/);
  });

  it("tells apps it accepts web-address ids", () => {
    expect(authorizationServerMetadata("https://www.postsocial.xyz")).toMatchObject({ client_id_metadata_document_supported: true });
  });
});

describe("problems found before the consent screen (open redirect)", () => {
  const ISSUER = "https://www.postsocial.xyz";
  const EVIL = "https://postsocial-login.example/session-expired";
  // A self-registered app; `approved` says whether this person has an active connection to it.
  const db = (approved: boolean) => {
    const queries: string[] = [];
    const sql = (async (query: string) => {
      queries.push(query);
      if (query.includes("FROM public.oauth_clients")) return [{ id: "c1", client_id: "psc_x", client_name: "Some app", redirect_uris: [EVIL], client_uri: null }];
      if (query.includes("FROM public.oauth_grants")) return approved ? [{ "?column?": 1 }] : [];
      return [];
    }) as Sql;
    return { sql, queries };
  };
  const good = { client_id: "psc_x", redirect_uri: EVIL, response_type: "code", code_challenge: "a".repeat(43), code_challenge_method: "S256" };

  it("shows the problem on our page instead of sending a person to an app they never approved", async () => {
    for (const params of [{ ...good, response_type: "x" }, { ...good, code_challenge: "short" }, { ...good, resource: "https://elsewhere.example" }, { ...good, scope: "admin" }]) {
      await expect(checkAuthorization(db(false).sql, ISSUER, params, undefined, "person-1")).rejects.toThrow(/can't use/);
    }
    // Without knowing who is asking, nothing is redirected either.
    await expect(checkAuthorization(db(true).sql, ISSUER, { ...good, response_type: "x" })).rejects.toThrow(/can't use/);
  });

  it("still sends the OAuth error back to an app the person already connected", async () => {
    const result = await checkAuthorization(db(true).sql, ISSUER, { ...good, response_type: "x", state: "s" }, undefined, "person-1");
    const back = new URL(result.redirect!);
    expect(back.origin + back.pathname).toBe(EVIL);
    expect(back.searchParams.get("error")).toBe("unsupported_response_type");
    expect(back.searchParams.get("state")).toBe("s");
  });

  it("asks nothing extra for a good request", async () => {
    const { sql, queries } = db(false);
    expect((await checkAuthorization(sql, ISSUER, good, undefined, "person-1")).redirect).toBeNull();
    expect(queries.some((q) => q.includes("oauth_grants"))).toBe(false);
  });

  it("refuses oversized or non-text fields quickly, before any parsing, and never redirects them", async () => {
    const started = performance.now();
    const huge = `${"/".repeat(260_000)}x`;
    await expect(checkAuthorization(db(true).sql, ISSUER, { ...good, resource: huge }, undefined, "person-1")).rejects.toThrow(/resource is not valid/);
    await expect(checkAuthorization(db(true).sql, ISSUER, { ...good, state: "s".repeat(5000) }, undefined, "person-1")).rejects.toThrow(/state is not valid/);
    await expect(checkAuthorization(db(true).sql, ISSUER, { ...good, scope: ["posts"] as unknown as string }, undefined, "person-1")).rejects.toThrow(/scope is not valid/);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("accepts this site's resource with trailing slashes", async () => {
    expect((await checkAuthorization(db(false).sql, ISSUER, { ...good, resource: `${ISSUER}/mcp///` }, undefined, "person-1")).redirect).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import type { Sql } from "../access";
import { authorizationServerMetadata, checkAuthorization, isMetadataClientId, protectedResourceMetadata, readClientMetadata, redirectMatches, redirectUriProblem } from "./server";

describe("OAuth discovery", () => {
  it("points AI apps from the MCP server to this site's sign-in", () => {
    const resource = protectedResourceMetadata("https://www.postsocial.xyz");
    expect(resource).toMatchObject({ resource: "https://www.postsocial.xyz/mcp", authorization_servers: ["https://www.postsocial.xyz"] });
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

  it("only accepts public https addresses with a path", () => {
    expect(isMetadataClientId(GROK)).toBe(true);
    expect(isMetadataClientId("psc_abc123")).toBe(false);
    expect(isMetadataClientId("http://grok.com/oauth/mcp-client.json")).toBe(false);
    expect(isMetadataClientId("https://grok.com/")).toBe(false);
    expect(isMetadataClientId("https://localhost/x.json")).toBe(false);
    expect(isMetadataClientId("https://127.0.0.1/x.json")).toBe(false);
    expect(isMetadataClientId("https://[::1]/x.json")).toBe(false);
    expect(isMetadataClientId("https://169.254.169.254/latest")).toBe(false);
    expect(isMetadataClientId("https://intranet/x.json")).toBe(false);
    expect(isMetadataClientId("https://box.internal/x.json")).toBe(false);
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

import { describe, expect, it } from "vitest";
import { authorizationServerMetadata, protectedResourceMetadata, redirectMatches, redirectUriProblem } from "./server";

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

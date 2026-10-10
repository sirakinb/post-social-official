// @vitest-environment node
import { describe, expect, it } from "vitest";
import { clientMetadata, dpopFetch, finishSignIn, newDpopKey, normalizeHandle, publicJwk, refreshSession, safeHttpsUrl, startSignIn, type BlueskySession, type PendingSignIn } from "./atproto";

const PDS = "https://morel.us-east.host.bsky.network";
const ISSUER = "https://bsky.social";

let clientJwk: JsonWebKey & { kid: string };
async function settings() {
  if (!clientJwk) {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    clientJwk = { ...(await crypto.subtle.exportKey("jwk", pair.privateKey)), kid: "k1" };
  }
  const values: Record<string, string> = {
    CONNECTIONS_BASE_URL: "https://fn.example.app/connections",
    WEB_APP_HOME: "https://www.postsocial.xyz/beta",
    BLUESKY_CLIENT_JWK: JSON.stringify(clientJwk),
  };
  return (name: string) => {
    if (!(name in values)) throw new Error(`missing ${name}`);
    return values[name];
  };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

function decode(jwt: string) {
  const [h, p] = jwt.split(".");
  const read = (s: string) => JSON.parse(atob(s.replace(/-/g, "+").replace(/_/g, "/")));
  return { header: read(h), payload: read(p) };
}

async function verifies(jwt: string, jwk: JsonWebKey) {
  const [h, p, s] = jwt.split(".");
  const key = await crypto.subtle.importKey("jwk", { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const sig = Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, sig, new TextEncoder().encode(`${h}.${p}`));
}

const serverMeta = {
  issuer: ISSUER,
  pushed_authorization_request_endpoint: `${ISSUER}/oauth/par`,
  authorization_endpoint: `${ISSUER}/oauth/authorize`,
  token_endpoint: `${ISSUER}/oauth/token`,
  revocation_endpoint: `${ISSUER}/oauth/revoke`,
};

describe("Bluesky sign-in", () => {
  it("describes our app with a public https client id, our key and DPoP", async () => {
    const setting = await settings();
    const meta = clientMetadata(setting, "https://fn.example.app/connections/oauth/bluesky/callback");
    expect(meta.client_id).toBe("https://fn.example.app/connections/oauth/bluesky/client-metadata.json");
    expect(meta.jwks_uri).toBe("https://fn.example.app/connections/oauth/bluesky/jwks.json");
    expect(meta).toMatchObject({ token_endpoint_auth_method: "private_key_jwt", dpop_bound_access_tokens: true, scope: "atproto transition:generic" });
    expect(publicJwk(clientJwk)).not.toHaveProperty("d");
  });

  it("pushes the request to the account's own server, retrying with the nonce it asks for", async () => {
    const setting = await settings();
    const calls: string[] = [];
    let par: URLSearchParams | undefined;
    const proofs: string[] = [];
    const http = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      calls.push(`${init.method ?? "GET"} ${url}`);
      if (url.includes("resolveHandle")) return json({ did: "did:plc:abcdefghijklmnopqrstuvwx" });
      if (url === "https://plc.directory/did:plc:abcdefghijklmnopqrstuvwx") return json({ alsoKnownAs: ["at://aki.bsky.social"], service: [{ id: "#atproto_pds", serviceEndpoint: PDS }] });
      if (url === `${PDS}/.well-known/oauth-protected-resource`) return json({ authorization_servers: [ISSUER] });
      if (url === `${ISSUER}/.well-known/oauth-authorization-server`) return json(serverMeta);
      if (url === `${ISSUER}/oauth/par`) {
        const proof = new Headers(init.headers).get("DPoP")!;
        proofs.push(proof);
        if (!decode(proof).payload.nonce) return json({ error: "use_dpop_nonce" }, 400, { "DPoP-Nonce": "n1" });
        par = new URLSearchParams(String(init.body));
        return json({ request_uri: "urn:ietf:params:oauth:request_uri:req-1" }, 201, { "DPoP-Nonce": "n2" });
      }
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;

    const { url, pending } = await startSignIn(setting, http, "state-1", "https://fn.example.app/connections/oauth/bluesky/callback", "@Aki.bsky.social");
    expect(url).toBe(`${ISSUER}/oauth/authorize?client_id=${encodeURIComponent("https://fn.example.app/connections/oauth/bluesky/client-metadata.json")}&request_uri=${encodeURIComponent("urn:ietf:params:oauth:request_uri:req-1")}`);
    expect(proofs).toHaveLength(2);
    expect(decode(proofs[1]).payload).toMatchObject({ htm: "POST", htu: `${ISSUER}/oauth/par`, nonce: "n1" });
    expect(await verifies(proofs[1], pending.dpopJwk)).toBe(true);
    expect(par!.get("login_hint")).toBe("aki.bsky.social");
    expect(par!.get("code_challenge_method")).toBe("S256");
    expect(par!.get("state")).toBe("state-1");
    const assertion = par!.get("client_assertion")!;
    expect(decode(assertion).payload).toMatchObject({ iss: "https://fn.example.app/connections/oauth/bluesky/client-metadata.json", aud: ISSUER });
    expect(await verifies(assertion, clientJwk)).toBe(true);
    expect(pending).toMatchObject({ did: "did:plc:abcdefghijklmnopqrstuvwx", nonce: "n2", server: { issuer: ISSUER, token: `${ISSUER}/oauth/token` } });
  });

  it("finishes only for the server it started with and the account entered", async () => {
    const setting = await settings();
    const pending: PendingSignIn = { verifier: "v", dpopJwk: await newDpopKey(), nonce: "n", server: { ...serverMetaTo(), issuer: ISSUER }, did: "did:plc:abcdefghijklmnopqrstuvwx" };
    const http = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `${ISSUER}/oauth/token`) return json({ token_type: "DPoP", access_token: "at", refresh_token: "rt", expires_in: 1800, scope: "atproto transition:generic", sub: "did:plc:abcdefghijklmnopqrstuvwx" }, 200, { "DPoP-Nonce": "n3" });
      if (url === "https://plc.directory/did:plc:abcdefghijklmnopqrstuvwx") return json({ alsoKnownAs: ["at://aki.bsky.social"], service: [{ id: "#atproto_pds", serviceEndpoint: PDS }] });
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;
    const redirect = "https://fn.example.app/connections/oauth/bluesky/callback";

    await expect(finishSignIn(setting, http, pending, new URLSearchParams({ code: "c", iss: "https://evil.example" }), redirect)).rejects.toThrow("unexpected server");
    const { session, handle } = await finishSignIn(setting, http, pending, new URLSearchParams({ code: "c", iss: ISSUER }), redirect);
    expect(session).toMatchObject({ accessToken: "at", refreshToken: "rt", did: "did:plc:abcdefghijklmnopqrstuvwx", pds: PDS, nonce: "n3" });
    expect(handle).toBe("aki.bsky.social");

    const other = { ...pending, did: "did:plc:zzzzzzzzzzzzzzzzzzzzzzzz" };
    await expect(finishSignIn(setting, http, other, new URLSearchParams({ code: "c", iss: ISSUER }), redirect)).rejects.toThrow("different Bluesky account");
  });

  it("renews with the single-use refresh token and keeps the new one", async () => {
    const setting = await settings();
    const session: BlueskySession = { accessToken: "old", refreshToken: "rt1", dpopJwk: await newDpopKey(), server: serverMetaTo(), did: "did:plc:abcdefghijklmnopqrstuvwx", pds: PDS, accessExpiresAt: 0 };
    let body: URLSearchParams | undefined;
    const http = (async (_input: RequestInfo | URL, init: RequestInit = {}) => {
      body = new URLSearchParams(String(init.body));
      return json({ token_type: "DPoP", access_token: "new", refresh_token: "rt2", expires_in: 1800, scope: "atproto transition:generic", sub: session.did });
    }) as typeof fetch;
    const renewed = await refreshSession(setting, http, session);
    expect(body!.get("refresh_token")).toBe("rt1");
    expect(renewed).toMatchObject({ accessToken: "new", refreshToken: "rt2" });
    expect(renewed.accessExpiresAt).toBeGreaterThan(Date.now());
  });

  it("binds resource calls to the access token (ath)", async () => {
    const jwk = await newDpopKey();
    let headers: Headers | undefined;
    const http = (async (_input: RequestInfo | URL, init: RequestInit = {}) => {
      headers = new Headers(init.headers);
      return json({});
    }) as typeof fetch;
    await dpopFetch(http, jwk, `${PDS}/xrpc/com.atproto.repo.createRecord?x=1`, { method: "POST" }, { accessToken: "at" });
    expect(headers!.get("Authorization")).toBe("DPoP at");
    const { payload } = decode(headers!.get("DPoP")!);
    expect(payload.htu).toBe(`${PDS}/xrpc/com.atproto.repo.createRecord`);
    expect(payload.ath).toBe("sda5G2fCr6XjIpiNlGJjjTVN34oe9526mH-BXCK0uu4");
  });

  it("only follows public https addresses and real handles", () => {
    for (const bad of ["http://pds.example.com", "https://127.0.0.1", "https://localhost", "https://pds.internal", "https://pds.example.com:8443", "https://[::1]"]) {
      expect(() => safeHttpsUrl(bad, "x")).toThrow();
    }
    expect(safeHttpsUrl("https://pds.example.com/x", "x").origin).toBe("https://pds.example.com");
    expect(normalizeHandle(" @Aki.BSKY.social ")).toBe("aki.bsky.social");
    expect(normalizeHandle("")).toBeNull();
    expect(() => normalizeHandle("not a handle")).toThrow("doesn't look like a Bluesky handle");
  });
});

function serverMetaTo() {
  return { issuer: ISSUER, par: serverMeta.pushed_authorization_request_endpoint, authorization: serverMeta.authorization_endpoint, token: serverMeta.token_endpoint, revocation: serverMeta.revocation_endpoint };
}

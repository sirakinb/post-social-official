// Signing in. `postsocial login` uses the same OAuth sign-in as AI apps: it registers
// itself, opens the browser to Post Social's consent page, and receives the code on this
// computer (127.0.0.1). `--key` (or POSTSOCIAL_API_KEY) uses an API key instead, for
// servers and CI. Saved to ~/.config/postsocial/credentials.json, readable only by you.
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import path from "node:path";

export const DEFAULT_BASE_URL = "https://www.postsocial.xyz";

export type Credentials =
  | { kind: "key"; baseUrl: string; key: string }
  | { kind: "oauth"; baseUrl: string; clientId: string; accessToken: string; refreshToken: string; expiresAt: number };

export const configDir = () => path.join(process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config"), "postsocial");
const credentialsFile = () => path.join(configDir(), "credentials.json");

export async function loadCredentials(): Promise<Credentials | null> {
  try {
    return JSON.parse(await readFile(credentialsFile(), "utf8")) as Credentials;
  } catch {
    return null;
  }
}

export async function saveCredentials(credentials: Credentials) {
  await mkdir(configDir(), { recursive: true, mode: 0o700 });
  await writeFile(credentialsFile(), JSON.stringify(credentials, null, 2), { mode: 0o600 });
  await chmod(credentialsFile(), 0o600);
}

export async function forgetCredentials() {
  await rm(credentialsFile(), { force: true });
}

const base64url = (buffer: Buffer) => buffer.toString("base64url");

function openBrowser(url: string) {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(command, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    // The link is also printed, so the person can open it themselves.
  }
}

async function postForm(url: string, form: Record<string, string>) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form) });
  const body = (await response.json().catch(() => ({}))) as Record<string, string>;
  if (!response.ok) throw new Error(body.error_description ?? body.error ?? `Sign-in failed (${response.status}).`);
  return body;
}

// Browser sign-in. `say` prints progress for people (to stderr, so stdout stays JSON).
export async function loginWithBrowser(baseUrl: string, say: (line: string) => void, open = openBrowser): Promise<Credentials> {
  const metadata = (await (await fetch(`${baseUrl}/.well-known/oauth-authorization-server`)).json()) as Record<string, string>;
  if (!metadata.authorization_endpoint) throw new Error(`${baseUrl} does not offer sign-in.`);

  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const state = base64url(randomBytes(16));

  let finish: (value: { code?: string; error?: string }) => void = () => {};
  const arrived = new Promise<{ code?: string; error?: string }>((resolve) => (finish = resolve));
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/callback") return void res.writeHead(404).end();
    const ok = url.searchParams.get("state") === state && url.searchParams.get("code");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><title>Post Social</title><body style="font-family:system-ui;padding:3rem;background:#0b0912;color:#eee"><h1>${ok ? "You're signed in" : "Sign-in didn't finish"}</h1><p>${ok ? "You can close this tab and go back to your terminal." : "Go back to your terminal and try again."}</p></body>`);
    finish(ok ? { code: url.searchParams.get("code")! } : { error: url.searchParams.get("error_description") ?? url.searchParams.get("error") ?? "The sign-in link did not match." });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  try {
    const registration = await fetch(metadata.registration_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_name: "Post Social CLI", redirect_uris: [redirectUri], grant_types: ["authorization_code", "refresh_token"], token_endpoint_auth_method: "none" }),
    });
    const client = (await registration.json()) as { client_id?: string; error_description?: string };
    if (!client.client_id) throw new Error(client.error_description ?? "Could not register the CLI.");

    const authorize = new URL(metadata.authorization_endpoint);
    for (const [k, v] of Object.entries({ response_type: "code", client_id: client.client_id, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: "S256", state, scope: "posts", resource: `${baseUrl}/mcp` })) {
      authorize.searchParams.set(k, v);
    }
    say(`Opening your browser to sign in. If it doesn't open, visit:\n${authorize}`);
    open(authorize.toString());

    const timeout = new Promise<{ code?: string; error?: string }>((resolve) => setTimeout(() => resolve({ error: "Sign-in timed out after 5 minutes." }), 5 * 60_000).unref());
    const result = await Promise.race([arrived, timeout]);
    if (!result.code) throw new Error(result.error ?? "Sign-in did not finish.");

    const tokens = await postForm(metadata.token_endpoint, { grant_type: "authorization_code", code: result.code, code_verifier: verifier, client_id: client.client_id, redirect_uri: redirectUri, resource: `${baseUrl}/mcp` });
    return { kind: "oauth", baseUrl, clientId: client.client_id, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: Date.now() + Number(tokens.expires_in) * 1000 };
  } finally {
    server.close();
  }
}

// A usable bearer token: the key, or a fresh access token (renewed and saved if needed).
export async function bearerToken(credentials: Credentials, force = false): Promise<string> {
  if (credentials.kind === "key") return credentials.key;
  if (!force && credentials.expiresAt - Date.now() > 60_000) return credentials.accessToken;
  const tokens = await postForm(`${credentials.baseUrl}/oauth/token`, { grant_type: "refresh_token", refresh_token: credentials.refreshToken, client_id: credentials.clientId }).catch(() => {
    throw new Error("Your sign-in has ended. Run `postsocial login` again.");
  });
  Object.assign(credentials, { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: Date.now() + Number(tokens.expires_in) * 1000 });
  await saveCredentials(credentials);
  return credentials.accessToken;
}

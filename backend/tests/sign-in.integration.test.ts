// @vitest-environment node
//
// Our own sign-in (backend/lib/auth) on a plain Postgres 15, set up the way the AWS database
// is. Runs against the local database from scripts/local-database.sh: `npm run test:pg`.
// Skipped by `npm test`. It proves what the move off InsForge Auth rests on: a person whose
// record came from InsForge signs in with the password they always had and keeps their id,
// and the new flows (confirm by code, reset by code) behave as the website expects.
import { readFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AUTH_PATH, createAuth } from "../lib/auth/auth";
import type { CodeKind } from "../lib/auth/emails";
import { assertUtc, poolConfig } from "../lib/database";
import { createService } from "../service";

const enabled = process.env.POSTSOCIAL_PG_TESTS === "1";
const port = process.env.LOCAL_DB_PORT ?? "55432";
const adminUrl = process.env.DATABASE_URL ?? `postgres://app_admin:local@127.0.0.1:${port}/postsocial`;
const userUrl = process.env.DATABASE_USER_URL ?? `postgres://app_user:local@127.0.0.1:${port}/postsocial`;
const ownerUrl = process.env.DATABASE_OWNER_URL ?? `postgres://postsocial_admin:local@127.0.0.1:${port}/postsocial`;

describe.skipIf(!enabled)("our own sign-in on plain Postgres", () => {
  const authPool = new pg.Pool(poolConfig({ url: adminUrl, max: 4, schema: "auth" }));
  const ownerPool = new pg.Pool(poolConfig({ url: ownerUrl, max: 1 }));
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const address = (name: string) => `signin-${name}-${suffix}@postsocial.test`;
  const sent: Array<{ kind: CodeKind; email: string; code: string }> = [];
  const errors: unknown[] = [];
  const auth = createAuth({
    pool: authPool,
    secret: "test-secret-".padEnd(40, "x"),
    baseUrl: "https://api.postsocial.test",
    trustedOrigins: ["https://www.postsocial.test"],
    sendCode: async (kind, email, code) => void sent.push({ kind, email, code }),
    onError: (error) => void errors.push(error),
  });

  // What Node's own fetch adds to every request, which is how our website's server calls
  // us. Better Auth reads these as a browser that won't say where it came from.
  const FROM_A_SERVER = { "Sec-Fetch-Mode": "cors", "Accept-Language": "*", Accept: "*/*" };
  const call = async (method: string, path: string, body?: unknown, token?: string | null, extra: Record<string, string> = {}) => {
    const response = await auth.handler(
      new Request(`https://api.postsocial.test${AUTH_PATH}${path}`, {
        method,
        headers: { "Content-Type": "application/json", ...FROM_A_SERVER, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    return { status: response.status, token: response.headers.get("set-auth-token"), cookies: response.headers.get("set-cookie"), body: (await response.json().catch(() => null)) as Record<string, unknown> | null };
  };
  // The code most recently emailed to someone. Sending isn't waited for, so give it a moment.
  const codeFor = async (kind: CodeKind, email: string) => {
    for (let tries = 0; tries < 40; tries++) {
      const found = sent.findLast((mail) => mail.kind === kind && mail.email === email);
      if (found) return found.code;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`No ${kind} code was sent.`);
  };
  const signUp = async (name: string, password = "a-good-password-1") => {
    const email = address(name);
    expect((await call("POST", "/sign-up/email", { email, password, name })).status).toBe(200);
    const confirmed = await call("POST", "/email-otp/verify-email", { email, otp: await codeFor("confirm-email", email) });
    expect(confirmed.status).toBe(200);
    return { email, password, token: confirmed.token! };
  };

  beforeAll(() => assertUtc());
  afterAll(async () => {
    await ownerPool.query(`DELETE FROM auth.users WHERE email LIKE $1`, [`signin-%-${suffix}@postsocial.test`]);
    await ownerPool.query(`DELETE FROM auth.verifications WHERE identifier LIKE $1`, [`%${suffix}%`]);
    await ownerPool.query(`DROP TABLE IF EXISTS auth.user_providers`);
    await authPool.end();
    await ownerPool.end();
  }, 60_000);

  it("signs a new person up, confirms their email by code, and only then signs them in", async () => {
    const email = address("new");
    const created = await call("POST", "/sign-up/email", { email, password: "a-good-password-1", name: "New Person" });
    expect(created.status).toBe(200);
    // Not signed in yet, and a right password isn't enough until the email is confirmed.
    expect(created.token).toBeNull();
    expect((await call("POST", "/sign-in/email", { email, password: "a-good-password-1" })).status).toBe(403);

    const code = await codeFor("confirm-email", email);
    expect(code).toMatch(/^\d{6}$/);
    const wrong = code === "000000" ? "000001" : "000000";
    expect((await call("POST", "/email-otp/verify-email", { email, otp: wrong })).status).toBe(400);

    const confirmed = await call("POST", "/email-otp/verify-email", { email, otp: code });
    expect(confirmed.status).toBe(200);
    expect(confirmed.token).toBeTruthy();
    // Our website keeps the token itself: no cookie comes back from here.
    expect(confirmed.cookies).toBeNull();

    const person = await auth.userForToken(confirmed.token);
    expect(person).toMatchObject({ email, name: "New Person" });
    // A UUID made by the database, like every other id.
    expect(person!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const { rows } = await ownerPool.query(`SELECT u.email_verified, u.password AS on_person, a.provider_id, a.account_id = u.id::text AS own_account, left(a.password, 7) AS format FROM auth.users u JOIN auth.accounts a ON a.user_id = u.id WHERE u.email = $1`, [email]);
    expect(rows).toEqual([{ email_verified: true, on_person: null, provider_id: "credential", own_account: true, format: "$2b$10$" }]);
    // The code itself is never stored.
    const kept = await ownerPool.query(`SELECT value FROM auth.verifications WHERE identifier LIKE $1`, [`%${email}%`]);
    expect(kept.rows.every((row) => !String(row.value).includes(code))).toBe(true);
  });

  it("holds new passwords to the same rule the website shows", async () => {
    const email = address("weak");
    expect(await call("POST", "/sign-up/email", { email, password: "short1", name: "W" })).toMatchObject({ status: 400, body: { message: "Use at least 12 characters." } });
    expect(await call("POST", "/sign-up/email", { email, password: "long-but-no-digits", name: "W" })).toMatchObject({ status: 400, body: { message: "Include at least one number." } });
    expect((await ownerPool.query(`SELECT 1 FROM auth.users WHERE email = $1`, [email])).rowCount).toBe(0);
  });

  it("signs in with a password, accepts only the signed token, and signs out", async () => {
    const { email, password } = await signUp("session");
    expect((await call("POST", "/sign-in/email", { email, password: "not-the-password-1" })).status).toBe(401);
    // The same answer for an address nobody has, so it can't be used to find accounts.
    expect((await call("POST", "/sign-in/email", { email: address("nobody"), password })).status).toBe(401);

    const signedIn = await call("POST", "/sign-in/email", { email: email.toUpperCase(), password });
    expect(signedIn.status).toBe(200);
    expect((await auth.userForToken(signedIn.token))?.email).toBe(email);
    // The bare token, as the database holds it, is not accepted without our signature.
    expect(await auth.userForToken(String(signedIn.body!.token))).toBeNull();
    expect(await auth.userForToken("made-up")).toBeNull();
    expect(await auth.userForToken(null)).toBeNull();

    const session = await ownerPool.query(`SELECT expires_at - now() AS left FROM auth.sessions s JOIN auth.users u ON u.id = s.user_id WHERE u.email = $1 ORDER BY s.created_at DESC LIMIT 1`, [email]);
    expect(session.rows[0].left.days).toBeGreaterThanOrEqual(29);

    expect((await call("POST", "/sign-out", {}, signedIn.token)).status).toBe(200);
    expect(await auth.userForToken(signedIn.token)).toBeNull();
  });

  it("resets a password by code, which ends every session and the old password", async () => {
    const { email, password, token } = await signUp("reset");
    expect((await call("POST", "/email-otp/request-password-reset", { email })).status).toBe(200);
    // An address nobody has gets the same answer and no email.
    expect((await call("POST", "/email-otp/request-password-reset", { email: address("ghost") })).status).toBe(200);
    const code = await codeFor("reset-password", email);
    expect(sent.some((mail) => mail.email === address("ghost"))).toBe(false);

    expect((await call("POST", "/email-otp/reset-password", { email, otp: code, password: "no-digits-in-this-one" })).status).toBe(400);
    expect((await call("POST", "/email-otp/reset-password", { email, otp: code, password: "a-new-password-22" })).status).toBe(200);
    expect(await auth.userForToken(token)).toBeNull();
    expect((await call("POST", "/sign-in/email", { email, password })).status).toBe(401);
    expect((await call("POST", "/sign-in/email", { email, password: "a-new-password-22" })).status).toBe(200);
    // A code works once.
    expect((await call("POST", "/email-otp/reset-password", { email, otp: code, password: "yet-another-one-33" })).status).toBe(400);
  });

  it("gives up on a code after five wrong tries", async () => {
    const email = address("guess");
    await call("POST", "/sign-up/email", { email, password: "a-good-password-1", name: "G" });
    const code = await codeFor("confirm-email", email);
    const wrong = code === "111111" ? "222222" : "111111";
    for (let i = 0; i < 5; i++) expect((await call("POST", "/email-otp/verify-email", { email, otp: wrong })).status).toBe(400);
    // Even the right code is dead now; a fresh one has to be asked for.
    expect((await call("POST", "/email-otp/verify-email", { email, otp: code })).status).toBeGreaterThanOrEqual(400);
    expect((await call("POST", "/email-otp/send-verification-otp", { email, type: "email-verification" })).status).toBe(200);
    const fresh = await (async () => {
      for (let tries = 0; tries < 40; tries++) {
        const codes = sent.filter((mail) => mail.kind === "confirm-email" && mail.email === email);
        if (codes.length >= 2) return codes[codes.length - 1].code;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error("No second code was sent.");
    })();
    expect((await call("POST", "/email-otp/verify-email", { email, otp: fresh })).status).toBe(200);
  });

  it("carries a person over from InsForge: same id, same password, Google link kept", async () => {
    const email = address("carried");
    const mixedCase = email.replace("signin-", "SignIn-");
    // As a copy of InsForge leaves them: the hash on the person, the name inside `profile`,
    // and the Google link in InsForge's own table.
    const hash = await bcrypt.hash("the-password-they-had-7", 10);
    const { rows: [person] } = await ownerPool.query(`INSERT INTO auth.users (email, password, email_verified, profile) VALUES ($1, $2, true, $3) RETURNING id`, [mixedCase, hash, { name: "Carried Over", avatar_url: "https://example.test/a.png" }]);
    await ownerPool.query(`CREATE TABLE auth.user_providers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, provider text NOT NULL, provider_account_id text NOT NULL, access_token text, refresh_token text, provider_data jsonb, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now())`);
    await ownerPool.query(`INSERT INTO auth.user_providers (user_id, provider, provider_account_id) VALUES ($1, 'google', $2)`, [person.id, `google-${suffix}`]);

    const move = readFileSync(new URL("../../database/migrate-auth.sql", import.meta.url), "utf8");
    await ownerPool.query(move);
    // Again, as every deploy does: nothing left to carry, nothing changes.
    await ownerPool.query(move);

    const { rows } = await ownerPool.query(`SELECT u.id, u.email, u.name, u.image, u.password AS on_person, (SELECT json_agg(json_build_object('provider', a.provider_id, 'account', a.account_id, 'same_hash', a.password = $2) ORDER BY a.provider_id) FROM auth.accounts a WHERE a.user_id = u.id) AS accounts FROM auth.users u WHERE u.id = $1`, [person.id, hash]);
    expect(rows[0]).toEqual({
      id: person.id,
      email,
      name: "Carried Over",
      image: "https://example.test/a.png",
      on_person: null,
      accounts: [
        { provider: "credential", account: person.id, same_hash: true },
        { provider: "google", account: `google-${suffix}`, same_hash: null },
      ],
    });
    expect((await ownerPool.query(`SELECT to_regclass('auth.user_providers') AS t`)).rows[0].t).toBeNull();

    const signedIn = await call("POST", "/sign-in/email", { email, password: "the-password-they-had-7" });
    expect(signedIn.status).toBe(200);
    expect(await auth.userForToken(signedIn.token)).toEqual({ id: person.id, email, name: "Carried Over" });
    expect((await call("POST", "/sign-in/email", { email, password: "not-their-password-7" })).status).toBe(401);
  });

  it("takes the session from the bearer token only, whatever else a request carries", async () => {
    const { email, password } = await signUp("headers");
    // Headers a browser on another site would send change nothing: the caller is our server.
    const signedIn = await call("POST", "/sign-in/email", { email, password }, null, { Origin: "https://somewhere-else.test", "Sec-Fetch-Site": "cross-site", Referer: "https://somewhere-else.test/page" });
    expect(signedIn.status).toBe(200);
    // A cookie is never a way in, even one carrying a real session token.
    const asCookie = { Cookie: `better-auth.session_token=${encodeURIComponent(signedIn.token!)}; __Secure-better-auth.session_token=${encodeURIComponent(signedIn.token!)}` };
    expect((await call("GET", "/get-session", undefined, null, asCookie)).body).toBeNull();
    expect((await call("GET", "/get-session", undefined, signedIn.token)).body).toMatchObject({ user: { email } });
  });

  it("offers only the routes the website uses", async () => {
    const { token } = await signUp("routes");
    expect((await call("GET", "/get-session", undefined, token)).status).toBe(200);
    for (const [method, path, body] of [
      ["POST", "/sign-in/email-otp", { email: address("routes"), otp: "123456" }],
      ["POST", "/email-otp/send-verification-otp", { email: address("routes"), type: "sign-in" }],
      ["POST", "/email-otp/send-verification-otp", { email: address("routes"), type: "forget-password" }],
      ["POST", "/change-email", { newEmail: address("other") }],
      ["POST", "/change-password", { currentPassword: "a-good-password-1", newPassword: "another-password-2" }],
      ["POST", "/update-user", { name: "X" }],
      ["POST", "/delete-user", {}],
      ["GET", "/list-sessions", undefined],
      ["POST", "/sign-in/social", { provider: "google" }],
      ["GET", "/ok", undefined],
      ["GET", "/sign-in/email", undefined],
    ] as const) {
      expect([method, path, (await call(method, path, body, token)).status]).toEqual([method, path, 404]);
    }
  });

  it("is reachable through the service only with our website's shared secret", async () => {
    const service = createService({
      env: (name) => ({ INTERNAL_PROXY_SECRET: "website-secret", WEB_APP_HOME: "https://www.postsocial.test/beta/accounts", R2_ACCOUNT_ID: "a", R2_BUCKET: "b", R2_ACCESS_KEY_ID: "c", R2_SECRET_ACCESS_KEY: "d", CONNECTIONS_BASE_URL: "https://api.postsocial.test/connections" })[name],
      base: { sql: async () => [], userForToken: auth.userForToken },
      ready: async () => true,
      workerSilence: async () => null,
      auth: { path: AUTH_PATH, handler: auth.handler },
    });
    const post = (headers: Record<string, string>) => service(new Request(`https://api.postsocial.test${AUTH_PATH}/sign-in/email`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ email: address("nobody"), password: "a-good-password-1" }) }));
    expect((await post({})).status).toBe(404);
    expect((await post({ "X-PS-Proxy-Secret": "a-wrong-secret" })).status).toBe(404);
    // With it, the request reaches sign-in (which says no to this made-up person).
    expect((await post({ "X-PS-Proxy-Secret": "website-secret" })).status).toBe(401);
  });

  it("keeps sign-in records away from a signed-in person's own queries", async () => {
    const userPool = new pg.Pool(poolConfig({ url: userUrl, max: 1 }));
    try {
      for (const table of ["auth.users", "auth.accounts", "auth.sessions", "auth.verifications"]) {
        await expect(userPool.query(`SELECT 1 FROM ${table} LIMIT 1`)).rejects.toThrow(/permission denied/);
      }
    } finally {
      await userPool.end();
    }
  });

  it("reported no errors along the way", () => {
    expect(errors).toEqual([]);
  });
});

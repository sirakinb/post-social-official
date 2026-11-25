// Our own sign-in, inside the API service (Better Auth). It replaces InsForge Auth:
//
//   - People stay in auth.users with the ids they always had. Beside them: auth.accounts
//     (a password's hash, or a Google link), auth.sessions, auth.verifications (emailed
//     codes). database/bootstrap.sql creates them; database/migrate-auth.sql carries
//     InsForge's records over.
//   - Passwords are bcrypt hashes, as InsForge made them, so nobody resets anything.
//   - An email address is confirmed, and a password reset, with a 6-digit code by email.
//   - A signed-in browser holds one token, which our website keeps in a cookie page scripts
//     can't read and sends to this API as a bearer token.
//
// Only our website's server may call these routes (backend/service.ts checks its shared
// secret), and only the ones listed in ALLOWED. The website applies the attempt limits
// (/internal/limits) before each call, as it does today, so Better Auth's own limiter is off.
//
// Node only: InsForge functions never import this.
import bcrypt from "bcryptjs";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { bearer, emailOTP } from "better-auth/plugins";
import type { Pool } from "pg";
import type { SignedInUser } from "../insforge-admin";
import type { Handler } from "../node-http";
import { CODE_MINUTES, type CodeKind } from "./emails";

export const AUTH_PATH = "/auth";
// Mirrors src/lib/insforge/auth-rules.ts, which says the same thing to the person first.
export const PASSWORD_MIN_LENGTH = 12;
const DAY = 24 * 60 * 60;
// Signed in for 30 days, pushed out again each day the person uses the app.
export const SESSION_SECONDS = 30 * DAY;
// The same work factor InsForge used, so every hash in the database is of one kind.
const BCRYPT_ROUNDS = 10;

export type AuthSettings = {
  // A pool of its own whose connections look in the `auth` schema (search_path=auth).
  pool: Pool;
  // Signs session tokens. At least 32 characters, made up in AWS, never in the repo.
  secret: string;
  // This API's public address, e.g. https://api-dev.postsocial.xyz
  baseUrl: string;
  // The website's addresses, the only places a browser is ever sent back to.
  trustedOrigins: string[];
  // Emails a code to a person. Failures are reported, never shown to the caller.
  sendCode: (kind: CodeKind, email: string, code: string) => Promise<void>;
  onError: (error: unknown) => void;
};

// Everything the website needs, and nothing else Better Auth offers (changing an email,
// signing in with a code alone, linking accounts). "METHOD path", under AUTH_PATH.
export const ALLOWED = new Set([
  "POST /sign-up/email",
  "POST /sign-in/email",
  "POST /sign-out",
  "GET /get-session",
  "POST /email-otp/send-verification-otp",
  "POST /email-otp/verify-email",
  "POST /email-otp/request-password-reset",
  "POST /email-otp/reset-password",
]);

// The only request headers sign-in is shown. Its caller is always our website's server,
// proved by the shared secret before a request gets here, and the session travels as a
// bearer token. So nothing a browser would add (cookies, where the page came from) has any
// say, and Better Auth's checks on those can't turn a server's call away.
const PASSED_ON = ["content-type", "authorization", "user-agent", "x-ps-client-ip"];

const snake = <T extends string>(...fields: T[]) => Object.fromEntries(fields.map((field) => [field, field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)])) as Record<T, string>;

export function passwordProblem(password: unknown): string | null {
  if (typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (!/[0-9]/.test(password)) return "Include at least one number.";
  return null;
}

export function createAuth(settings: AuthSettings) {
  if (settings.secret.length < 32) throw new Error("AUTH_SECRET must be at least 32 characters.");

  const auth = betterAuth({
    appName: "Post Social",
    baseURL: settings.baseUrl,
    basePath: AUTH_PATH,
    secret: settings.secret,
    database: settings.pool,
    trustedOrigins: settings.trustedOrigins,
    // Nothing about our people or our setup is sent to anyone.
    telemetry: { enabled: false },
    rateLimit: { enabled: false },
    // Errors only, and through our reporter: Better Auth's own log lines can name people.
    logger: { level: "error", log: (_level, message) => settings.onError(new Error(`Sign-in: ${message}`)) },
    advanced: {
      // Ids are UUIDs made by the database, like every id we already have.
      database: { generateId: "uuid" },
      // The visitor's address as our website passes it on (the caller is always the
      // website's server, which the shared secret has already proved).
      ipAddress: { ipAddressHeaders: ["x-ps-client-ip"] },
    },
    user: { modelName: "users", fields: snake("emailVerified", "createdAt", "updatedAt") },
    session: {
      modelName: "sessions",
      fields: snake("userId", "expiresAt", "ipAddress", "userAgent", "createdAt", "updatedAt"),
      expiresIn: SESSION_SECONDS,
      updateAge: DAY,
    },
    account: {
      modelName: "accounts",
      fields: snake("userId", "providerId", "accountId", "accessToken", "refreshToken", "idToken", "accessTokenExpiresAt", "refreshTokenExpiresAt", "createdAt", "updatedAt"),
      // Google sign-in is off. When it comes back, links are made only on purpose.
      accountLinking: { enabled: false },
    },
    verification: { modelName: "verifications", fields: snake("expiresAt", "createdAt", "updatedAt") },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: 128,
      // Signing up doesn't sign you in: the email is confirmed first.
      autoSignIn: false,
      revokeSessionsOnPasswordReset: true,
      password: {
        hash: (password) => bcrypt.hash(password, BCRYPT_ROUNDS),
        // Anything that isn't a bcrypt hash is refused rather than guessed at.
        verify: async ({ hash, password }) => /^\$2[aby]\$\d{2}\$/.test(hash) && (await bcrypt.compare(password, hash)),
      },
    },
    emailVerification: { autoSignInAfterVerification: true },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: CODE_MINUTES * 60,
        allowedAttempts: 5,
        // Kept as a hash: reading the database doesn't give anyone a working code.
        storeOTP: "hashed",
        sendVerificationOnSignUp: true,
        overrideDefaultEmailVerification: true,
        // A code alone never signs anyone in or creates an account.
        disableSignUp: true,
        async sendVerificationOTP({ email, otp, type }) {
          const kind: CodeKind | null = type === "email-verification" ? "confirm-email" : type === "forget-password" ? "reset-password" : null;
          if (!kind) return;
          // Not waited for, so how long the answer takes says nothing about the address.
          void settings.sendCode(kind, email, otp).catch(settings.onError);
        },
      }),
      // The website sends the session token as "Authorization: Bearer", and only the
      // signed form is accepted: a token read out of the database is useless by itself.
      bearer({ requireSignature: true }),
    ],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // The two places a new password arrives.
        if (ctx.path !== "/sign-up/email" && ctx.path !== "/email-otp/reset-password") return;
        const problem = passwordProblem(ctx.body?.password);
        if (problem) throw new APIError("BAD_REQUEST", { message: problem, code: "PASSWORD_TOO_WEAK" });
      }),
    },
  });

  const notFound = () => new Response(JSON.stringify({ error: "Not found." }), { status: 404, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

  // The routes, for backend/service.ts to mount at AUTH_PATH.
  const handler: Handler = async (request) => {
    const path = new URL(request.url).pathname;
    if (!path.startsWith(`${AUTH_PATH}/`) || !ALLOWED.has(`${request.method} ${path.slice(AUTH_PATH.length)}`)) return notFound();
    const body = request.method === "GET" ? undefined : await request.text();
    if (path === `${AUTH_PATH}/email-otp/send-verification-otp`) {
      // Only to confirm an address. The same route can also send a sign-in code, which we don't offer.
      let type: unknown;
      try {
        type = (JSON.parse(body ?? "") as { type?: unknown } | null)?.type;
      } catch {
        // Not JSON: not ours.
      }
      if (type !== "email-verification") return notFound();
    }
    const headers = new Headers();
    for (const name of PASSED_ON) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    const answer = await auth.handler(new Request(request.url, { method: request.method, headers, body }));
    // The website reads the token from "set-auth-token" and sets its own cookie. Better
    // Auth's cookies are for a browser talking to it directly, which never happens here.
    const answerHeaders = new Headers(answer.headers);
    answerHeaders.delete("Set-Cookie");
    answerHeaders.set("Cache-Control", "no-store");
    return new Response(answer.body, { status: answer.status, headers: answerHeaders });
  };

  // Who a session token belongs to, or null. The same answer InsForge's check gave, so no
  // caller changes.
  async function userForToken(token: string | null): Promise<SignedInUser | null> {
    if (!token) return null;
    const session = await auth.api.getSession({ headers: new Headers({ Authorization: `Bearer ${token}` }) }).catch((error) => {
      settings.onError(error);
      return null;
    });
    const user = session?.user;
    if (!user?.id || !user.email) return null;
    return { id: user.id, email: user.email, name: user.name || user.email };
  }

  return { handler, userForToken };
}

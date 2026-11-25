// Everything the `api` handler needs, built from settings. Shared by the InsForge function
// (index.ts) and the Node service (backend/service.ts), so the two can't drift apart.
import type { Sql } from "../../lib/access";
import { callerForKey } from "../../lib/api/keys";
import { createStripe } from "../../lib/billing";
import { statsPlatforms } from "../../lib/connections/platforms";
import { inboxSwitch } from "../../lib/inbox/automations";
import type { SignedInUser } from "../../lib/insforge-admin";
import { createR2 } from "../../lib/media/r2";
import { callerForAccessToken } from "../../lib/oauth/server";
import { listOf, required, type Env } from "../../lib/settings";
import type { ApiHandlerDeps } from "./handler";

export type BackendBase = {
  sql: Sql;
  userForToken: (token: string | null) => Promise<SignedInUser | null>;
};

export function apiDeps(env: Env, base: BackendBase): ApiHandlerDeps {
  const setting = required(env);
  const webAppUrl = setting("WEB_APP_HOME").replace(/\/beta\/accounts\/?$/, "");
  const stripeKey = env("STRIPE_SECRET_KEY");
  return {
    sql: base.sql,
    r2: createR2({
      accountId: setting("R2_ACCOUNT_ID"),
      bucket: setting("R2_BUCKET"),
      accessKeyId: setting("R2_ACCESS_KEY_ID"),
      secretAccessKey: setting("R2_SECRET_ACCESS_KEY"),
    }),
    newId: () => crypto.randomUUID(),
    webAppUrl,
    analyticsPlatforms: statsPlatforms(setting),
    inbox: inboxSwitch(env),
    setting,
    publicApiUrl: `${webAppUrl}/api`,
    callerForKey,
    callerForAccessToken,
    userForToken: base.userForToken,
    allowedOrigins: listOf(env, "WEB_APP_ORIGINS"),
    proxySecret: env("INTERNAL_PROXY_SECRET") ?? null,
    // Billing switches on per environment once STRIPE_SECRET_KEY is set.
    stripe: stripeKey ? createStripe(stripeKey) : null,
    stripeWebhookSecret: env("STRIPE_WEBHOOK_SECRET") ?? null,
  };
}

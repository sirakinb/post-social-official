// Everything the `connections` handler needs, built from settings. Shared by the InsForge
// function (index.ts) and the Node service (backend/service.ts).
import { createStripe, syncAccountQuantity } from "../../lib/billing";
import { publicConnectionsUrl } from "../../lib/connections/addresses";
import { forwardSettings } from "../../lib/inbox/webhooks";
import { listOf, required, type Env } from "../../lib/settings";
import type { BackendBase } from "../api/deps";
import type { ConnectionsHandlerDeps } from "./handler";

export function connectionsDeps(env: Env, base: BackendBase): ConnectionsHandlerDeps {
  const setting = required(env);
  const stripeKey = env("STRIPE_SECRET_KEY");
  // Keeps the billed account count in step with connected accounts (Paid workspaces only).
  const billing = { sql: base.sql, stripe: stripeKey ? createStripe(stripeKey) : null, webAppUrl: "" };
  return {
    sql: base.sql,
    setting,
    allowedReturnOrigins: listOf(env, "WEB_APP_ORIGINS"),
    userForToken: base.userForToken,
    webAppHome: setting("WEB_APP_HOME"),
    metaAppSecrets: ["META_APP_SECRET", "INSTAGRAM_APP_SECRET", "THREADS_APP_SECRET"].map((name) => env(name)).filter((value): value is string => Boolean(value)),
    selfBaseUrl: publicConnectionsUrl(setting),
    metaWebhookVerifyToken: env("META_WEBHOOK_VERIFY_TOKEN") ?? null,
    metaWebhookForward: forwardSettings(env),
    afterAccountsChanged: (workspaceId) => syncAccountQuantity(billing, workspaceId),
  };
}

// Deno entry point for the `connections` InsForge function. Settings come from secrets.
import { withReporting } from "../../lib/telemetry";
import { createSql, userForToken } from "../../lib/insforge-admin";
import { createConnectionsHandler } from "./handler";
import { createStripe, syncAccountQuantity } from "../../lib/billing";

declare const Deno: { env: { get(name: string): string | undefined } };

function setting(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing secret ${name}`);
  return value;
}

const baseUrl = setting("INSFORGE_BASE_URL");
const sql = createSql(baseUrl, setting("API_KEY"));
const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
// Keeps the billed account count in step with connected accounts (Paid workspaces only).
const billing = { sql, stripe: stripeKey ? createStripe(stripeKey) : null, webAppUrl: "" };
const list = (name: string) => (Deno.env.get(name) ?? "").split(",").map((v) => v.trim()).filter(Boolean);

export default withReporting("connections", (name) => Deno.env.get(name), createConnectionsHandler({
  sql,
  setting,
  allowedReturnOrigins: list("WEB_APP_ORIGINS"),
  userForToken: (token) => userForToken(baseUrl, token),
  webAppHome: setting("WEB_APP_HOME"),
  metaAppSecrets: ["META_APP_SECRET", "INSTAGRAM_APP_SECRET", "THREADS_APP_SECRET"].map((n) => Deno.env.get(n)).filter((v): v is string => Boolean(v)),
  selfBaseUrl: setting("CONNECTIONS_BASE_URL"),
  afterAccountsChanged: (workspaceId) => syncAccountQuantity(billing, workspaceId),
}));

// Deno entry point for the `api` InsForge function. Settings come from secrets.
import { withReporting } from "../../lib/telemetry";
import { createSql, userForToken } from "../../lib/insforge-admin";
import { callerForKey } from "../../lib/api/keys";
import { callerForAccessToken } from "../../lib/oauth/server";
import { analyticsPlatforms } from "../../lib/connections/platforms";
import { createR2 } from "../../lib/media/r2";
import { createApiHandler } from "./handler";

declare const Deno: { env: { get(name: string): string | undefined } };

function setting(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing secret ${name}`);
  return value;
}

const baseUrl = setting("INSFORGE_BASE_URL");
const webAppUrl = setting("WEB_APP_HOME").replace(/\/beta\/accounts\/?$/, "");

export default withReporting("api", (name) => Deno.env.get(name), createApiHandler({
  sql: createSql(baseUrl, setting("API_KEY")),
  r2: createR2({
    accountId: setting("R2_ACCOUNT_ID"),
    bucket: setting("R2_BUCKET"),
    accessKeyId: setting("R2_ACCESS_KEY_ID"),
    secretAccessKey: setting("R2_SECRET_ACCESS_KEY"),
  }),
  newId: () => crypto.randomUUID(),
  webAppUrl,
  analyticsPlatforms: analyticsPlatforms(setting),
  setting,
  publicApiUrl: `${webAppUrl}/api`,
  callerForKey,
  callerForAccessToken,
  userForToken: (token) => userForToken(baseUrl, token),
  allowedOrigins: (Deno.env.get("WEB_APP_ORIGINS") ?? "").split(",").map((o) => o.trim()).filter(Boolean),
}));

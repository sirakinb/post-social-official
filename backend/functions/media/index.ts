// Deno entry point for the `media` InsForge function. Bundled into one file by
// scripts/deploy-function.sh. Settings come from InsForge secrets.
import { createSql, userForToken } from "../../lib/insforge-admin";
import { createR2 } from "../../lib/media/r2";
import { createMediaHandler } from "./handler";

declare const Deno: { env: { get(name: string): string | undefined } };

function setting(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing secret ${name}`);
  return value;
}

const baseUrl = setting("INSFORGE_BASE_URL");

export default createMediaHandler({
  sql: createSql(baseUrl, setting("API_KEY")),
  r2: createR2({
    accountId: setting("R2_ACCOUNT_ID"),
    bucket: setting("R2_BUCKET"),
    accessKeyId: setting("R2_ACCESS_KEY_ID"),
    secretAccessKey: setting("R2_SECRET_ACCESS_KEY"),
  }),
  newId: () => crypto.randomUUID(),
  userForToken: (token) => userForToken(baseUrl, token),
  allowedOrigins: (Deno.env.get("WEB_APP_ORIGINS") ?? "").split(",").map((o) => o.trim()).filter(Boolean),
});

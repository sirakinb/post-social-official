// Deno entry point for the `api` InsForge function. Bundled into one file by
// scripts/deploy-function.sh. Settings come from InsForge secrets (deps.ts reads them).
import { withReporting } from "../../lib/telemetry";
import { createSql, userForToken } from "../../lib/insforge-admin";
import { required } from "../../lib/settings";
import { apiDeps } from "./deps";
import { createApiHandler } from "./handler";

declare const Deno: { env: { get(name: string): string | undefined } };

const env = (name: string) => Deno.env.get(name);
const baseUrl = required(env)("INSFORGE_BASE_URL");

export default withReporting("api", env, createApiHandler(apiDeps(env, {
  sql: createSql(baseUrl, required(env)("API_KEY")),
  userForToken: (token) => userForToken(baseUrl, token),
})));

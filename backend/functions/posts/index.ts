// Deno entry point for the `posts` InsForge function. Bundled into one file by
// scripts/deploy-function.sh. Settings come from InsForge secrets (deps.ts reads them).
import { withReporting } from "../../lib/telemetry";
import { createSql, userForToken } from "../../lib/insforge-admin";
import { required } from "../../lib/settings";
import { postsDeps } from "./deps";
import { createPostsHandler } from "./handler";

declare const Deno: { env: { get(name: string): string | undefined } };

const env = (name: string) => Deno.env.get(name);
const baseUrl = required(env)("INSFORGE_BASE_URL");

export default withReporting("posts", env, createPostsHandler(postsDeps(env, {
  sql: createSql(baseUrl, required(env)("API_KEY")),
  userForToken: (token) => userForToken(baseUrl, token),
})));

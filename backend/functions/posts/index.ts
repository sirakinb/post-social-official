// Deno entry point for the `posts` InsForge function. Settings come from secrets.
import { createSql, userForToken } from "../../lib/insforge-admin";
import { createPostsHandler } from "./handler";

declare const Deno: { env: { get(name: string): string | undefined } };

function setting(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing secret ${name}`);
  return value;
}

const baseUrl = setting("INSFORGE_BASE_URL");

export default createPostsHandler({
  sql: createSql(baseUrl, setting("API_KEY")),
  userForToken: (token) => userForToken(baseUrl, token),
  allowedOrigins: (Deno.env.get("WEB_APP_ORIGINS") ?? "").split(",").map((o) => o.trim()).filter(Boolean),
});

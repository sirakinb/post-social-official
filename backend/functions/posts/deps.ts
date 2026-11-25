// Everything the `posts` handler needs, built from settings. Shared by the InsForge function
// (index.ts) and the Node service (backend/service.ts).
import { listOf, type Env } from "../../lib/settings";
import type { BackendBase } from "../api/deps";
import type { PostsHandlerDeps } from "./handler";

export function postsDeps(env: Env, base: BackendBase): PostsHandlerDeps {
  return { sql: base.sql, userForToken: base.userForToken, allowedOrigins: listOf(env, "WEB_APP_ORIGINS") };
}

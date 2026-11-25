// Everything the `media` handler needs, built from settings. Shared by the InsForge function
// (index.ts) and the Node service (backend/service.ts).
import { createR2 } from "../../lib/media/r2";
import { listOf, required, type Env } from "../../lib/settings";
import type { BackendBase } from "../api/deps";
import type { HandlerDeps } from "./handler";

export function mediaDeps(env: Env, base: BackendBase): HandlerDeps {
  const setting = required(env);
  return {
    sql: base.sql,
    r2: createR2({
      accountId: setting("R2_ACCOUNT_ID"),
      bucket: setting("R2_BUCKET"),
      accessKeyId: setting("R2_ACCESS_KEY_ID"),
      secretAccessKey: setting("R2_SECRET_ACCESS_KEY"),
    }),
    newId: () => crypto.randomUUID(),
    userForToken: base.userForToken,
    allowedOrigins: listOf(env, "WEB_APP_ORIGINS"),
  };
}

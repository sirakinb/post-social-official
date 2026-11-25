// The Post Social API as one Node service (AWS: containers behind the load balancer).
// Settings come from environment variables. Built into one file by backend/build.sh.
//
<<<<<<< HEAD
// Needs the app_admin login (DATABASE_URL, or on AWS DATABASE_HOST, DATABASE_NAME and
// DATABASE_PASSWORD). On AWS the rest arrive as one JSON object in SETTINGS_JSON. Sign-in
// tokens are checked with InsForge while INSFORGE_BASE_URL is set; without it nobody can
// sign in through this service yet.
import "./lib/load-settings"; // first: spreads SETTINGS_JSON into the environment
import { createServer } from "node:http";
import pg from "pg";
import { assertUtc, databaseAddress, poolConfig, poolSql } from "./lib/database";
import { userForToken } from "./lib/insforge-admin";
import { nodeListener } from "./lib/node-http";
import type { Env } from "./lib/settings";
=======
// Needs DATABASE_URL (the app_admin login). Sign-in tokens are checked with InsForge while
// INSFORGE_BASE_URL is set; without it nobody can sign in through this service yet.
import { createServer } from "node:http";
import pg from "pg";
import { assertUtc, poolConfig, poolSql } from "./lib/database";
import { userForToken } from "./lib/insforge-admin";
import { nodeListener } from "./lib/node-http";
import { required, type Env } from "./lib/settings";
>>>>>>> origin/dev
import { createTelemetry, flushReports, reportError, setErrorReporter } from "./lib/telemetry";
import { createService } from "./service";

assertUtc();

const env: Env = (name) => process.env[name];
<<<<<<< HEAD
=======
const setting = required(env);
>>>>>>> origin/dev

function log(message: string, details: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ time: new Date().toISOString(), message, ...details }));
}

setErrorReporter(createTelemetry({ key: env("POSTHOG_KEY"), host: env("POSTHOG_HOST"), service: "api", environment: env("APP_ENV") ?? "dev" }));

<<<<<<< HEAD
const address = databaseAddress(env, "app");
if (!address) throw new Error("Missing database settings: set DATABASE_URL, or DATABASE_HOST, DATABASE_NAME and DATABASE_PASSWORD.");
const pool = new pg.Pool(poolConfig({
  ...address,
=======
const pool = new pg.Pool(poolConfig({
  url: setting("DATABASE_URL"),
>>>>>>> origin/dev
  caFile: env("DATABASE_CA_FILE") ?? null,
  max: Number(env("DATABASE_POOL_MAX") ?? 10),
  applicationName: "postsocial-api",
}));
// A dropped idle connection must not take the service down; the pool replaces it.
pool.on("error", (error) => reportError(error, { area: "database pool" }));
const sql = poolSql(pool);

const insforge = env("INSFORGE_BASE_URL");
const service = createService({
  env,
  base: { sql, userForToken: insforge ? (token) => userForToken(insforge, token) : async () => null },
  ready: async () => (await sql("select 1 as ok", [])).length === 1,
});

const server = createServer(nodeListener(service, {
  // The load balancer asks /healthz every few seconds; only the failures are worth a line.
  log: (entry) => { if (entry.path !== "/healthz" || entry.status !== 200) log("request", entry); },
  onError: (error) => reportError(error, { area: "http" }),
}));
// Longer than the load balancer's 60 second idle limit, so it is never the one to find a
// connection we already closed.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

process.on("unhandledRejection", (reason) => reportError(reason, { area: "unhandled rejection" }));

// A deploy stops the old copies with SIGTERM: finish the requests in hand, then leave.
let stopping = false;
async function stop(signal: string) {
  if (stopping) return;
  stopping = true;
  log("stopping", { signal });
  setTimeout(() => process.exit(0), 25_000).unref();
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeIdleConnections();
  });
  await flushReports();
  await pool.end().catch(() => {});
  process.exit(0);
}
process.on("SIGTERM", () => void stop("SIGTERM"));
process.on("SIGINT", () => void stop("SIGINT"));

const port = Number(env("PORT") ?? 8080);
server.listen(port, () => log("api started", { port, environment: env("APP_ENV") ?? "dev", signIn: insforge ? "insforge" : "off" }));

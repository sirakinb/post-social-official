// Brings a plain Postgres database up to date: node migrate.mjs [--bootstrap] [--baseline]
//
//   --bootstrap   first run database/bootstrap.sql (roles, the auth schema; safe to repeat)
//   --baseline    record every migration as applied without running it (a database that
//                 was just filled from a copy of InsForge)
//
// Needs DATABASE_OWNER_URL, the owner login (never the API's own login). Built into one file
// by backend/build.sh, next to the migrations/ folder and bootstrap.sql it reads.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { poolConfig } from "./lib/database";
import { migrate, parseMigrationName, type MigrationFile } from "./lib/migrations";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const unknown = [...args].filter((arg) => arg !== "--bootstrap" && arg !== "--baseline");
if (unknown.length) {
  console.error(`Unknown option ${unknown.join(", ")}. Use --bootstrap and/or --baseline.`);
  process.exit(2);
}

const url = process.env.DATABASE_OWNER_URL;
if (!url) {
  console.error("Set DATABASE_OWNER_URL to the database owner's address.");
  process.exit(2);
}

const directory = process.env.MIGRATIONS_DIR ?? path.join(here, "migrations");
const files: MigrationFile[] = readdirSync(directory).flatMap((file) => {
  const parsed = parseMigrationName(file);
  if (!parsed) {
    if (file.endsWith(".sql")) throw new Error(`Migration file ${file} isn't named <14 digits>_<name>.sql`);
    return [];
  }
  return [{ ...parsed, sql: readFileSync(path.join(directory, file), "utf8") }];
});

const { max: _max, idleTimeoutMillis: _idle, ...config } = poolConfig({ url, caFile: process.env.DATABASE_CA_FILE ?? null, statementTimeoutMs: 10 * 60_000, applicationName: "postsocial-migrate" });
const client = new pg.Client(config);
try {
  await client.connect();
  if (args.has("--bootstrap")) {
    await client.query(readFileSync(process.env.BOOTSTRAP_FILE ?? path.join(here, "bootstrap.sql"), "utf8"));
    console.log("bootstrap done");
  }
  const applied = await migrate(client, files, { baseline: args.has("--baseline"), log: (message) => console.log(message) });
  console.log(applied.length ? `${applied.length} migration(s) ${args.has("--baseline") ? "recorded" : "applied"}` : "already up to date");
} catch (error) {
  // The message only: a connection error must not print the address.
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}

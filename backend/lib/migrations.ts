// Applies the SQL files in migrations/ to a plain Postgres database (AWS RDS, or a local
// one), in name order, each in its own transaction, and remembers which ones are done in
// app_meta.migrations. On InsForge its own CLI does this; the files are the same.
//
// Run as the database's owner login. Each file runs as project_admin, so what it creates is
// owned by project_admin, as on InsForge (database/bootstrap.sql explains the roles).
import type { Queryable } from "./database";

export type MigrationFile = { version: string; name: string; sql: string };

// "20261004034129_core-schema.sql" -> { version: "20261004034129", name: "core-schema" }
export function parseMigrationName(file: string): { version: string; name: string } | null {
  const match = /^(\d{14})_([a-z0-9][a-z0-9-]*)\.sql$/.exec(file);
  return match ? { version: match[1], name: match[2] } : null;
}

export function sortMigrations(files: MigrationFile[]): MigrationFile[] {
  const sorted = [...files].sort((a, b) => a.version.localeCompare(b.version));
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].version === sorted[i - 1].version) throw new Error(`Two migrations share the version ${sorted[i].version}.`);
  }
  return sorted;
}

type Options = {
  // Record every file as applied without running it. For a database that was just filled
  // from a copy of InsForge, where these changes are already in the data.
  baseline?: boolean;
  log?: (message: string) => void;
};

const rows = <T>(result: unknown) => ((Array.isArray(result) ? result[result.length - 1] : result) as { rows?: T[] })?.rows ?? [];

// Returns the versions applied (or recorded) in this run. `client` must be one connection,
// not a pool: the lock and the transactions belong to it.
export async function migrate(client: Queryable, files: MigrationFile[], options: Options = {}): Promise<string[]> {
  const log = options.log ?? (() => {});
  // One runner at a time, so two deploys can't apply the same file together.
  await client.query("SELECT pg_advisory_lock(hashtext('postsocial-migrations'))");
  try {
    const done = new Set(rows<{ version: string }>(await client.query("SELECT version FROM app_meta.migrations")).map((row) => row.version));
    const pending = sortMigrations(files).filter((file) => !done.has(file.version));
    if (options.baseline && done.size) throw new Error("This database already has applied migrations; a baseline is only for a freshly copied one.");
    const applied: string[] = [];
    for (const file of pending) {
      await client.query("BEGIN");
      try {
        if (!options.baseline) {
          await client.query("SET LOCAL ROLE project_admin");
          await client.query(file.sql);
          await client.query("RESET ROLE");
        }
        await client.query("INSERT INTO app_meta.migrations (version, name) VALUES ($1, $2)", [file.version, file.name]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw new Error(`Migration ${file.version}_${file.name} failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      }
      applied.push(file.version);
      log(`${options.baseline ? "recorded" : "applied"} ${file.version}_${file.name}`);
    }
    return applied;
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('postsocial-migrations'))").catch(() => {});
  }
}

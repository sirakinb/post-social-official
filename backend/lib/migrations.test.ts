// @vitest-environment node
import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { migrate, parseMigrationName, sortMigrations, type MigrationFile } from "./migrations";

const file = (version: string, name = "change"): MigrationFile => ({ version, name, sql: `-- ${version}` });

function fakeClient(applied: string[] = [], failOn?: string) {
  const statements: string[] = [];
  const query = vi.fn(async (text: string, values?: unknown[]) => {
    statements.push(values ? `${text} ${JSON.stringify(values)}` : text);
    if (failOn && text === failOn) throw new Error("syntax error");
    return { rows: text.startsWith("SELECT version") ? applied.map((version) => ({ version })) : [] };
  });
  return { client: { query }, statements };
}

describe("migration files", () => {
  it("reads the version and name from a file name", () => {
    expect(parseMigrationName("20261004034129_core-schema.sql")).toEqual({ version: "20261004034129", name: "core-schema" });
    for (const bad of ["core-schema.sql", "2026_core.sql", "20261004034129_Core.sql", "20261004034129_core.sql.bak", "README.md"]) expect(parseMigrationName(bad)).toBeNull();
  });

  it("every file in migrations/ is named so the runner picks it up", () => {
    const names = readdirSync(path.resolve(__dirname, "../../migrations"));
    expect(names.length).toBeGreaterThan(40);
    expect(names.filter((name) => !parseMigrationName(name))).toEqual([]);
  });

  it("orders by version and refuses two files with the same one", () => {
    expect(sortMigrations([file("20260102000000"), file("20260101000000")]).map((f) => f.version)).toEqual(["20260101000000", "20260102000000"]);
    expect(() => sortMigrations([file("20260101000000", "a"), file("20260101000000", "b")])).toThrow(/share the version/);
  });
});

describe("migrate", () => {
  it("applies only what is new, in order, each as project_admin in its own transaction", async () => {
    const { client, statements } = fakeClient(["20260101000000"]);
    const applied = await migrate(client, [file("20260103000000", "third"), file("20260101000000"), file("20260102000000", "second")]);
    expect(applied).toEqual(["20260102000000", "20260103000000"]);
    expect(statements).toEqual([
      "SELECT pg_advisory_lock(hashtext('postsocial-migrations'))",
      "SELECT version FROM app_meta.migrations",
      "BEGIN", "SET LOCAL ROLE project_admin", "-- 20260102000000", "RESET ROLE",
      'INSERT INTO app_meta.migrations (version, name) VALUES ($1, $2) ["20260102000000","second"]', "COMMIT",
      "BEGIN", "SET LOCAL ROLE project_admin", "-- 20260103000000", "RESET ROLE",
      'INSERT INTO app_meta.migrations (version, name) VALUES ($1, $2) ["20260103000000","third"]', "COMMIT",
      "SELECT pg_advisory_unlock(hashtext('postsocial-migrations'))",
    ]);
  });

  it("stops at the first failure, rolls it back, names the file and releases the lock", async () => {
    const { client, statements } = fakeClient([], "-- 20260101000000");
    await expect(migrate(client, [file("20260101000000", "broken"), file("20260102000000")])).rejects.toThrow(/20260101000000_broken failed: syntax error/);
    expect(statements).toContain("ROLLBACK");
    expect(statements).not.toContain("-- 20260102000000");
    expect(statements.at(-1)).toMatch(/pg_advisory_unlock/);
  });

  it("a baseline records every file without running any, and only on a database with none recorded", async () => {
    const fresh = fakeClient();
    expect(await migrate(fresh.client, [file("20260101000000"), file("20260102000000")], { baseline: true })).toEqual(["20260101000000", "20260102000000"]);
    expect(fresh.statements.some((s) => s.startsWith("-- ") || s.includes("SET LOCAL ROLE"))).toBe(false);
    expect(fresh.statements.filter((s) => s.startsWith("INSERT INTO app_meta.migrations"))).toHaveLength(2);

    const used = fakeClient(["20260101000000"]);
    await expect(migrate(used.client, [file("20260101000000"), file("20260102000000")], { baseline: true })).rejects.toThrow(/baseline is only for/);
  });
});

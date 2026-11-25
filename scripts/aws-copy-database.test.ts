// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addressIn, migrationGap } from "./aws-copy-database.mjs";

describe("copying a database to AWS", () => {
  it("finds the database address in what the InsForge CLI prints", () => {
    expect(addressIn('✓ Connection string:\n  postgresql://postgres:abc123@db.example.app:5432/insforge?sslmode=require\n')).toBe("postgresql://postgres:abc123@db.example.app:5432/insforge?sslmode=require");
    expect(addressIn('{"connectionString":"postgres://u:p@h/db"}')).toBe("postgres://u:p@h/db");
    expect(addressIn("Not linked to a project.")).toBeNull();
  });

  it("copies only when InsForge and the AWS build have the same migrations", () => {
    const files = ["migrations/20261004034129_core-schema.sql", "migrations/20261122130000_last-connected-at.sql"];
    expect(migrationGap(["20261004034129", 20261122130000], files)).toEqual({ onlyInsforge: [], onlyBuild: [] });
    expect(migrationGap(["20261004034129"], files)).toEqual({ onlyInsforge: [], onlyBuild: ["20261122130000"] });
    expect(migrationGap(["20261004034129", "20261122130000", "20261201000000"], files)).toEqual({ onlyInsforge: ["20261201000000"], onlyBuild: [] });
    // A file that isn't a migration is not counted.
    expect(migrationGap(["20261004034129"], ["migrations/20261004034129_core-schema.sql", "migrations/README.md"])).toEqual({ onlyInsforge: [], onlyBuild: [] });
  });

  it("never prints or stores the address, and refuses prod until cutover", () => {
    const script = readFileSync(new URL("./aws-copy-database.mjs", import.meta.url), "utf8");
    // The address reaches AWS on standard input only, and is blanked whatever happens.
    expect(script).toContain('"--secret-string", "file:///dev/stdin"');
    expect(script).not.toMatch(/console\.(log|error)\([^)]*address/);
    expect(script).not.toMatch(/writeFileSync|appendFileSync/);
    expect(script).toMatch(/finally \{[\s\S]*put-secret-value/);
    expect(script).toContain('const ENVIRONMENTS = { dev:');
    expect(script).not.toMatch(/prod: \{ api:/);
  });

  it("the copy itself changes nothing unless every step works, and leaves InsForge's keys behind", () => {
    const copy = readFileSync(new URL("../database/copy-from-insforge.sh", import.meta.url), "utf8");
    const begin = copy.indexOf("BEGIN;");
    const commit = copy.indexOf("COMMIT;");
    for (const step of ["DROP SCHEMA public CASCADE;", "TRUNCATE auth.users;", "pg_restore --file=-", "UPDATE auth.user_providers SET access_token = NULL"]) {
      // The last mention: the same tool is used once earlier, only to read the dump.
      expect(copy.lastIndexOf(step)).toBeGreaterThan(begin);
      expect(copy.lastIndexOf(step)).toBeLessThan(commit);
    }
    expect(copy).toContain("ON_ERROR_STOP=1");
    for (const table of ["auth.config", "auth.custom_oauth_configs", "auth.email_otps", "auth.oauth_configs"]) expect(copy).toContain(`--exclude-table=${table}`);
    // InsForge's defaults for future tables and its schema grants are not brought over.
    expect(copy).toContain("DEFAULT ACL ");
    expect(copy).not.toMatch(/echo[^\n]*SOURCE_URL[^\n]*\$\{?SOURCE_URL(?!:)/);
  });
});

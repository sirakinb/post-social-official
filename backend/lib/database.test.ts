// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { assertUtc, databaseAddress, DatabaseError, poolConfig, poolSql, userSql } from "./database";

const USER = "11111111-2222-4333-8444-555555555555";

describe("poolSql", () => {
  it("returns rows the way InsForge's SQL endpoint did: through JSON", async () => {
    const query = vi.fn(async () => ({ rows: [{ at: new Date("2026-01-02T03:04:05.123Z"), total: "12", meta: { a: 1 }, missing: undefined }] }));
    const rows = await poolSql({ query })("select 1", []);
    expect(rows).toEqual([{ at: "2026-01-02T03:04:05.123Z", total: "12", meta: { a: 1 } }]);
  });

  it("sends parameters across the same JSON boundary", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    await poolSql({ query })("select $1, $2, $3", [new Date("2026-01-02T03:04:05.000Z"), undefined, { a: undefined, b: 1 }]);
    expect(query).toHaveBeenCalledWith("select $1, $2, $3", ["2026-01-02T03:04:05.000Z", null, { b: 1 }]);
  });

  it("answers with the last statement's rows when a query holds several", async () => {
    const query = vi.fn(async () => [{ rows: [] }, { rows: [{ n: 2 }] }]);
    expect(await poolSql({ query })("select 1; select 2 as n", [])).toEqual([{ n: 2 }]);
  });

  it("keeps Postgres's sentence and code on errors", async () => {
    const failure = Object.assign(new Error('duplicate key value violates unique constraint "profiles_workspace_name_idx"'), { code: "23505", detail: "Key (name)=(Secret) already exists." });
    const error = await poolSql({ query: vi.fn(async () => { throw failure; }) })("insert", []).catch((e) => e);
    expect(error).toBeInstanceOf(DatabaseError);
    expect(error.code).toBe("23505");
    expect(error.message).toMatch(/duplicate key/);
    // The row's contents are in `detail`, which never reaches the message.
    expect(error.message).not.toMatch(/Secret/);
  });
});

describe("userSql", () => {
  function fakePool(run: (text: string) => unknown = () => ({ rows: [{ ok: true }] })) {
    const statements: string[] = [];
    const release = vi.fn();
    const client = { query: vi.fn(async (text: string) => { statements.push(text); return run(text) as { rows: unknown[] }; }), release };
    return { pool: { connect: vi.fn(async () => client) }, statements, release };
  }

  it("runs each query in its own transaction as the signed-in person", async () => {
    const { pool, statements, release } = fakePool();
    expect(await userSql(pool, USER)("select * from posts", [])).toEqual([{ ok: true }]);
    expect(statements).toEqual([
      `BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', '{"sub":"${USER}","role":"authenticated"}', true)`,
      "select * from posts",
      "COMMIT",
    ]);
    expect(release).toHaveBeenCalledWith(false);
  });

  it("refuses anything that isn't a user id, since the id is placed in the statement", () => {
    const { pool } = fakePool();
    for (const bad of ["", "abc", `${USER}'; DROP TABLE posts; --`, `'${USER}'`]) expect(() => userSql(pool, bad)).toThrow(/user id/);
  });

  it("rolls back and returns the connection when the query fails", async () => {
    const { pool, statements, release } = fakePool((text) => { if (text.startsWith("select")) throw new Error("permission denied for table x"); return { rows: [] }; });
    await expect(userSql(pool, USER)("select * from x", [])).rejects.toThrow(/permission denied/);
    expect(statements.at(-1)).toBe("ROLLBACK");
    expect(release).toHaveBeenCalledWith(false);
  });

  it("drops the connection when even the rollback fails", async () => {
    const { pool, release } = fakePool((text) => { if (!text.startsWith("BEGIN")) throw new Error("connection lost"); return { rows: [] }; });
    await expect(userSql(pool, USER)("select 1", [])).rejects.toThrow(/connection lost/);
    expect(release).toHaveBeenCalledWith(true);
  });
});

describe("databaseAddress", () => {
  const env = (values: Record<string, string>) => (name: string) => values[name];
  const parts = { DATABASE_HOST: "db.example.rds.amazonaws.com", DATABASE_NAME: "postsocial", DATABASE_PASSWORD: "app-password", DATABASE_OWNER_USERNAME: "postsocial_admin", DATABASE_OWNER_PASSWORD: "owner-password" };

  it("prefers one address when it is given", () => {
    expect(databaseAddress(env({ ...parts, DATABASE_URL: "postgres://a:b@h/d" }), "app")).toEqual({ url: "postgres://a:b@h/d" });
    expect(databaseAddress(env({ ...parts, DATABASE_OWNER_URL: "postgres://o:b@h/d" }), "owner")).toEqual({ url: "postgres://o:b@h/d" });
  });

  it("builds it from parts on AWS: the app login is always app_admin, the owner's name is given", () => {
    expect(databaseAddress(env(parts), "app")).toEqual({ host: parts.DATABASE_HOST, port: 5432, database: "postsocial", user: "app_admin", password: "app-password" });
    expect(databaseAddress(env({ ...parts, DATABASE_PORT: "6543" }), "owner")).toEqual({ host: parts.DATABASE_HOST, port: 6543, database: "postsocial", user: "postsocial_admin", password: "owner-password" });
  });

  it("is null when a part is missing, so the caller can say what to set", () => {
    expect(databaseAddress(env({}), "app")).toBeNull();
    expect(databaseAddress(env({ DATABASE_HOST: "h", DATABASE_NAME: "d" }), "app")).toBeNull();
    expect(databaseAddress(env({ DATABASE_HOST: "h", DATABASE_NAME: "d", DATABASE_PASSWORD: "p" }), "owner")).toBeNull();
    expect(() => databaseAddress(env({ ...parts, DATABASE_PORT: "abc" }), "app")).toThrow(/DATABASE_PORT/);
  });

  it("gives poolConfig an encrypted, checked connection", () => {
    const config = poolConfig({ ...databaseAddress(env(parts), "app")!, caFile: "/app/rds-ca.pem" }, () => "CA");
    expect(config).toMatchObject({ host: parts.DATABASE_HOST, port: 5432, user: "app_admin", password: "app-password", database: "postsocial", ssl: { rejectUnauthorized: true, ca: "CA" } });
  });
});

describe("poolConfig", () => {
  const ca = () => "CERT";

  it("encrypts and checks the certificate for a remote database, with our CA file", () => {
    const config = poolConfig({ url: "postgres://app_admin:p%40ss%2Fword@db.example.rds.amazonaws.com:5432/postsocial", caFile: "/app/rds-ca.pem" }, ca);
    expect(config).toMatchObject({ host: "db.example.rds.amazonaws.com", port: 5432, user: "app_admin", password: "p@ss/word", database: "postsocial", max: 10, options: "-c timezone=UTC" });
    expect(config.ssl).toEqual({ rejectUnauthorized: true, ca: "CERT" });
  });

  it("can keep a pool to one schema, for our sign-in's tables", () => {
    expect(poolConfig({ url: "postgres://u:p@db.example.com/postsocial", schema: "auth" }, ca).options).toBe("-c timezone=UTC -c search_path=auth");
    for (const schema of ["auth, public", "auth -c role=postgres", "Auth", ""]) expect(() => poolConfig({ url: "postgres://u:p@db.example.com/postsocial", schema }, ca)).toThrow("Not a schema name.");
  });

  it("can't be talked out of checking the certificate by the address", () => {
    for (const mode of ["no-verify", "require", "prefer", "allow"]) {
      const config = poolConfig({ url: `postgres://u:p@db.example.com/postsocial?sslmode=${mode}` }, ca);
      expect(config.ssl).toEqual({ rejectUnauthorized: true });
    }
  });

  it("skips encryption only for a database on this machine, or when asked outright", () => {
    expect(poolConfig({ url: "postgres://u:p@127.0.0.1:55432/postsocial", caFile: "/app/rds-ca.pem" }, ca).ssl).toBe(false);
    expect(poolConfig({ url: "postgres://u:p@localhost/postsocial" }, ca).ssl).toBe(false);
    expect(poolConfig({ url: "postgres://u:p@db/postsocial?sslmode=disable" }, ca).ssl).toBe(false);
    expect(poolConfig({ url: "postgres://u:p@localhost/postsocial?sslmode=require" }, ca).ssl).toEqual({ rejectUnauthorized: true });
  });

  it("never repeats the address in an error, since it holds the password", () => {
    for (const url of ["not a url hunter2", "https://u:hunter2@db/postsocial", "postgres://u:hunter2@/postsocial", "postgres://u:hunter2@db"]) {
      let message = "";
      try { poolConfig({ url }, ca); } catch (error) { message = (error as Error).message; }
      expect(message).not.toBe("");
      expect(message).not.toMatch(/hunter2/);
    }
  });
});

describe("assertUtc", () => {
  it("passes in UTC and refuses anywhere else", () => {
    expect(() => assertUtc({ getTimezoneOffset: () => 0 } as Date)).not.toThrow();
    expect(() => assertUtc({ getTimezoneOffset: () => 300 } as Date)).toThrow(/UTC/);
  });
});

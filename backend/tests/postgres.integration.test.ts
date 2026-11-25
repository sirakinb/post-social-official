// @vitest-environment node
//
// The backend on a plain Postgres 15, set up the way the AWS database is. Runs against the
// local database from scripts/local-database.sh: `npm run test:pg`. Skipped by `npm test`.
// It proves the three things the move to AWS rests on: our migrations build the schema
// without InsForge, queries return exactly what InsForge returned, and the access policies
// hold when the API runs a query for a signed-in person.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Caller } from "../lib/access";
import { createKey } from "../lib/api/keys";
import { assertUtc, DatabaseError, poolConfig, poolSql, userSql } from "../lib/database";
<<<<<<< HEAD
import { scramVerifier, setPasswordStatement } from "../lib/scram";
=======
>>>>>>> origin/dev
import { provisionWorkspace } from "../lib/signup";
import { createService } from "../service";

const enabled = process.env.POSTSOCIAL_PG_TESTS === "1";
const port = process.env.LOCAL_DB_PORT ?? "55432";
const adminUrl = process.env.DATABASE_URL ?? `postgres://app_admin:local@127.0.0.1:${port}/postsocial`;
const userUrl = process.env.DATABASE_USER_URL ?? `postgres://app_user:local@127.0.0.1:${port}/postsocial`;
<<<<<<< HEAD
const ownerUrl = process.env.DATABASE_OWNER_URL ?? `postgres://postsocial_admin:local@127.0.0.1:${port}/postsocial`;
=======
>>>>>>> origin/dev

describe.skipIf(!enabled)("the backend on plain Postgres", () => {
  const adminPool = new pg.Pool(poolConfig({ url: adminUrl, max: 4 }));
  // One connection, so every signed-in query below reuses it: a leak between people would show.
  const userPool = new pg.Pool(poolConfig({ url: userUrl, max: 1 }));
  const sql = poolSql(adminPool);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const people: Record<"ada" | "ben", { id: string; workspaceId: string }> = { ada: { id: "", workspaceId: "" }, ben: { id: "", workspaceId: "" } };

  beforeAll(async () => {
    assertUtc();
    for (const name of ["ada", "ben"] as const) {
      const [user] = await sql<{ id: string }>(`INSERT INTO auth.users (email, email_verified, profile) VALUES ($1, true, $2) RETURNING id`, [`pg-${name}-${suffix}@postsocial.test`, { name }]);
      const caller: Caller = { userId: user.id, displayName: `${name} ${suffix}`, entryPoint: "ui" };
      const { workspace_id } = await provisionWorkspace(sql, caller);
      people[name] = { id: user.id, workspaceId: workspace_id };
    }
  }, 60_000);

  afterAll(async () => {
    const workspaces = Object.values(people).map((p) => p.workspaceId).filter(Boolean);
    const users = Object.values(people).map((p) => p.id).filter(Boolean);
    if (workspaces.length) await sql(`DELETE FROM public.workspaces WHERE id = ANY($1::uuid[])`, [workspaces]);
    if (users.length) await sql(`DELETE FROM auth.users WHERE id = ANY($1::uuid[])`, [users]);
    await adminPool.end();
    await userPool.end();
  }, 60_000);

  it("returns every column type exactly as InsForge's SQL endpoint did", async () => {
    const [row] = await sql(
      `select '2026-01-02 03:04:05.123456+00'::timestamptz as ts, date '2026-03-04' as d, 9007199254740993::int8 as big, 1.50::numeric as num,
              2::int4 as i, 1.5::float8 as f, '{"a":1}'::jsonb as j, array[1,2] as arr, array['a','b']::text[] as tarr,
              array['2026-01-02 03:04:05+00'::timestamptz] as tsarr, interval '1 day 2 hours' as iv, '\\x01ff'::bytea as b, null as n, true as t,
              '00000000-0000-0000-0000-000000000001'::uuid as u, '12:30'::time as tm, timestamp '2026-01-02 03:04:05' as tsnotz, count(*) as c,
              'x'::char(3) as ch, int4range(1,5) as rng, 3::int2 as small, 1.5::real as r4, '{}'::json as js from (select 1) x`,
      [],
    );
    // Captured from the InsForge dev backend on 2026-11-25 with this same query.
    expect(row).toEqual({
      ts: "2026-01-02T03:04:05.123Z", d: "2026-03-04T00:00:00.000Z", big: "9007199254740993", num: "1.50", i: 2, f: 1.5, j: { a: 1 }, arr: [1, 2], tarr: ["a", "b"],
      tsarr: ["2026-01-02T03:04:05.000Z"], iv: { days: 1, hours: 2 }, b: { type: "Buffer", data: [1, 255] }, n: null, t: true,
      u: "00000000-0000-0000-0000-000000000001", tm: "12:30:00", tsnotz: "2026-01-02T03:04:05.000Z", c: "1", ch: "x  ", rng: "[1,5)", small: 3, r4: 1.5, js: {},
    });
  });

  it("takes parameters the way callers already pass them", async () => {
    const [row] = await sql<{ at: string; ids: string[]; meta: { a: number }; missing: null }>(
      `select $1::timestamptz as at, $2::uuid[] as ids, $3::jsonb as meta, $4::text as missing`,
      [new Date("2026-05-06T07:08:09.000Z"), [people.ada.id], { a: 1 }, undefined],
    );
    expect(row).toEqual({ at: "2026-05-06T07:08:09.000Z", ids: [people.ada.id], meta: { a: 1 }, missing: null });
  });

  it("has the schema our migrations describe, owned by project_admin, with every table protected", async () => {
    const [shape] = await sql<{ tables: string; unprotected: string; other_owners: string; policies: string; functions: string; me: string }>(
      `select (select count(*) from pg_tables where schemaname = 'public') as tables,
              (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity) as unprotected,
              (select count(*) from pg_tables where schemaname = 'public' and tableowner <> 'project_admin') as other_owners,
              (select count(*) from pg_policies where schemaname = 'public') as policies,
              (select count(*) from pg_proc where pronamespace = 'public'::regnamespace) as functions,
              current_user as me`,
      [],
    );
    expect(shape.me).toBe("project_admin");
    expect(Number(shape.tables)).toBeGreaterThanOrEqual(56);
    expect(Number(shape.policies)).toBeGreaterThanOrEqual(27);
    expect(Number(shape.functions)).toBeGreaterThanOrEqual(30);
    expect([shape.unprotected, shape.other_owners]).toEqual(["0", "0"]);
  });

  it("keeps Postgres's error code, e.g. for a duplicate", async () => {
    const error = await sql(`INSERT INTO auth.users (email) VALUES ($1)`, [`pg-ada-${suffix}@postsocial.test`]).catch((e) => e);
    expect(error).toBeInstanceOf(DatabaseError);
    expect(error.code).toBe("23505");
    expect(error.message).toMatch(/duplicate key/);
  });

  describe("queries for a signed-in person", () => {
    it("show each person their own workspace and posts, and nobody else's", async () => {
      // Ada, then Ben, then Ada again, all on the same connection.
      for (const name of ["ada", "ben", "ada"] as const) {
        const mine = userSql(userPool, people[name].id);
        const other = people[name === "ada" ? "ben" : "ada"];
        expect(await mine<{ id: string }>(`select id from public.workspaces`, [])).toEqual([{ id: people[name].workspaceId }]);
        const posts = await mine<{ workspace_id: string }>(`select workspace_id from public.posts`, []);
        expect(posts.length).toBeGreaterThan(0); // the sample draft
        expect(posts.every((post) => post.workspace_id === people[name].workspaceId)).toBe(true);
        expect(await mine(`select id from public.workspaces where id = $1`, [other.workspaceId])).toEqual([]);
        expect(await mine(`select id from public.posts where workspace_id = $1`, [other.workspaceId])).toEqual([]);
        const [who] = await mine<{ uid: string; me: string }>(`select auth.uid() as uid, current_user as me`, []);
        expect(who).toEqual({ uid: people[name].id, me: "authenticated" });
      }
    });

    it("can't reach tables that are for the service only, or change what they can read", async () => {
      const mine = userSql(userPool, people.ada.id);
      for (const table of ["public.waitlist", "public.rate_limits", "public.workspace_billing", "public.oauth_access_tokens", "auth.users"]) {
        await expect(mine(`select * from ${table} limit 1`, []), table).rejects.toThrow(/permission denied/);
      }
      await expect(mine(`delete from public.posts where workspace_id = $1 returning id`, [people.ada.workspaceId])).rejects.toThrow(/permission denied/);
    });

    it("leave no identity behind on the connection, and can't step up to the service's role", async () => {
      const client = await userPool.connect();
      try {
        const { rows } = await client.query(`select auth.uid() as uid, current_user as me, (select count(*) from public.workspaces) as visible`);
        expect(rows[0]).toEqual({ uid: null, me: "authenticated", visible: "0" });
        await expect(client.query(`SET ROLE project_admin`)).rejects.toThrow(/permission denied/);
        await expect(client.query(`SET ROLE app_admin`)).rejects.toThrow(/permission denied/);
      } finally {
        client.release();
      }
    });
  });

  describe("the Node service on this database", () => {
    const settings: Record<string, string> = {
      WEB_APP_HOME: "https://www.postsocial.xyz/beta/accounts",
      R2_ACCOUNT_ID: "acct", R2_BUCKET: "bucket", R2_ACCESS_KEY_ID: "id", R2_SECRET_ACCESS_KEY: "secret",
      CONNECTIONS_BASE_URL: "https://api.postsocial.xyz/connections",
    };
    const service = createService({ env: (name) => settings[name], base: { sql, userForToken: async () => null }, ready: async () => (await sql("select 1", [])).length === 1 });
    const call = (path: string, key?: string) => service(new Request(`https://api.postsocial.xyz${path}`, { headers: key ? { Authorization: `Bearer ${key}` } : {} }));

    it("is ready, and answers an API key the way the InsForge function does", async () => {
      expect((await call("/readyz")).status).toBe(200);
      const { key } = await createKey(sql, { userId: people.ada.id, displayName: "Ada", entryPoint: "ui" }, { workspace_id: people.ada.workspaceId, name: "pg test", mode: "live" });

      const accounts = await call("/api/v1/accounts", key);
      expect(accounts.status, await accounts.clone().text()).toBe(200);
      const posts = await call("/api/v1/posts", key);
      expect(posts.status, await posts.clone().text()).toBe(200);
      expect(JSON.stringify(await posts.json())).not.toContain(people.ben.workspaceId);

      expect((await call("/api/v1/accounts", "ps_live_not_a_real_key_000000000000000000000000")).status).toBe(401);
      expect((await call("/api/v1/accounts")).status).toBe(401);
    });
  });
<<<<<<< HEAD

  it("a login can sign in with a password that was only ever sent to the database as a hash", async () => {
    // What migrate.mjs --bootstrap does on AWS for app_admin, on a throwaway login here.
    const role = `test_login_${suffix.replace(/[^a-z0-9]/g, "_")}`;
    const password = `pw${suffix.replace(/[^a-z0-9]/g, "")}0123456789abcdef`;
    const owner = new pg.Client(poolConfig({ url: ownerUrl }));
    await owner.connect();
    try {
      await owner.query(`CREATE ROLE ${role} LOGIN`);
      await owner.query(setPasswordStatement(role, password));
      const [{ rolpassword }] = (await owner.query(`select rolpassword from pg_authid where rolname = $1`, [role]).catch(() => ({ rows: [{ rolpassword: null }] }))).rows;
      // Only a superuser can read pg_authid; when we can, check nothing but the hash is stored.
      if (rolpassword) expect(rolpassword).toMatch(/^SCRAM-SHA-256\$4096:/);

      const login = new pg.Client(poolConfig({ host: "127.0.0.1", port: Number(port), database: "postsocial", user: role, password }));
      await login.connect();
      expect((await login.query("select current_user as who")).rows).toEqual([{ who: role }]);
      await login.end();

      const wrong = new pg.Client(poolConfig({ host: "127.0.0.1", port: Number(port), database: "postsocial", user: role, password: `${password}x` }));
      await expect(wrong.connect()).rejects.toThrow(/password authentication failed/);
      await wrong.end().catch(() => {});
      expect(scramVerifier(password)).not.toContain(password);
    } finally {
      await owner.query(`DROP ROLE IF EXISTS ${role}`);
      await owner.end();
    }
  });
=======
>>>>>>> origin/dev
});

// Direct Postgres access for the Node API service and the worker (AWS). It keeps the `Sql`
// signature the rest of the backend already uses, and returns exactly what InsForge's SQL
// endpoint returned, so no caller changes:
//
//   - InsForge ran each query with the standard `pg` client and sent the rows back as JSON.
//     We run the same client and pass rows through JSON the same way, so a timestamp is still
//     an ISO string, a bigint or numeric still a string, and so on. The process must run in
//     UTC for dates to match (the Dockerfiles set TZ=UTC; `assertUtc` checks it at start).
//   - Parameters crossed the same JSON boundary on the way in, so they do here too.
//
// Node only: it reads the certificate file from disk. Functions on InsForge never import it.
import { readFileSync } from "node:fs";
import type { PoolConfig } from "pg";
import type { Sql } from "./access";
import type { Env } from "./settings";

type QueryResult = { rows?: unknown[] } | Array<{ rows?: unknown[] }>;
export type Queryable = { query: (text: string, values?: unknown[]) => Promise<QueryResult> };
export type Connectable = { connect: () => Promise<Queryable & { release: (destroy?: boolean) => void }> };

// A database error, with Postgres's own code (e.g. 23505 for a duplicate) when there is one.
// The message keeps Postgres's sentence, which a few callers match on.
export class DatabaseError extends Error {
  readonly code: string | null;
  constructor(cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const code = typeof (cause as { code?: unknown })?.code === "string" ? (cause as { code: string }).code : null;
    super(`Database error${code ? ` (${code})` : ""}: ${message}`, { cause });
    this.name = "DatabaseError";
    this.code = code;
  }
}

// What a value looks like after a trip through JSON: dates become ISO strings, undefined
// becomes null inside arrays, and so on.
const throughJson = <T>(value: T): T => (value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T));

// A query with no parameters may hold several statements; the answer is the last one's rows.
function rowsOf<T>(result: QueryResult): T[] {
  const last = Array.isArray(result) ? result[result.length - 1] : result;
  return throughJson((last?.rows ?? []) as T[]);
}

// Queries as the service itself (project_admin): the API's own access checks apply, the
// database's access policies don't. Each call is its own statement, as it was over HTTPS.
export function poolSql(pool: Queryable): Sql {
  return async <T>(query: string, params: unknown[]) => {
    try {
      return rowsOf<T>(await pool.query(query, throughJson(params)));
    } catch (error) {
      throw new DatabaseError(error);
    }
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Queries for one signed-in person: the database's access policies apply, reading the
// person's id through auth.uid(). Each call runs in its own transaction, so the identity
// can't leak to the next query on the same connection. Give it a pool that signs in as
// app_user, which can't step up to project_admin.
export function userSql(pool: Connectable, userId: string): Sql {
  if (!UUID.test(userId)) throw new Error("userSql needs a user id.");
  // Safe to place in the statement: it is a checked UUID, and JSON adds only quotes and braces.
  const claims = JSON.stringify({ sub: userId.toLowerCase(), role: "authenticated" });
  const begin = `BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', '${claims}', true)`;
  return async <T>(query: string, params: unknown[]) => {
    const client = await pool.connect();
    let broken = false;
    try {
      await client.query(begin);
      const rows = rowsOf<T>(await client.query(query, throughJson(params)));
      await client.query("COMMIT");
      return rows;
    } catch (error) {
      // If even the rollback fails the connection is in an unknown state: drop it.
      await client.query("ROLLBACK").catch(() => { broken = true; });
      throw new DatabaseError(error);
    } finally {
      client.release(broken);
    }
  };
}

// Where the database is and who signs in. Either one address, or its parts: on AWS the host
// is plain configuration and only the password comes from Secrets Manager, so no connection
// string with a password in it exists anywhere.
export type DatabaseAddress =
  | { url: string } // postgres://user:password@host:5432/name
  | { host: string; port?: number; database: string; user: string; password: string };

export type DatabaseSettings = DatabaseAddress & {
  caFile?: string | null; // certificate authority to trust (AWS's RDS bundle, in the image)
  max?: number;
  statementTimeoutMs?: number;
  applicationName?: string;
  // The one schema this pool's connections look in (our sign-in's tables live in `auth`).
  // Left out, Postgres's usual lookup applies.
  schema?: string;
};

// The login the API and the worker use. bootstrap.sql creates it; it runs as project_admin.
export const APP_LOGIN = "app_admin";
// The login a person looks at the data with. database/viewer.sql creates it; it can only read.
export const VIEWER_LOGIN = "app_viewer";

// Reads a login's address from settings: "app" is the API's and the worker's own login,
// "owner" is the database owner's (setup and migrations only). Null when nothing is set.
//
//   app     DATABASE_URL,       or DATABASE_HOST + DATABASE_NAME + DATABASE_PASSWORD
//   owner   DATABASE_OWNER_URL, or DATABASE_HOST + DATABASE_NAME + DATABASE_OWNER_USERNAME + DATABASE_OWNER_PASSWORD
export function databaseAddress(env: Env, login: "app" | "owner"): DatabaseAddress | null {
  const url = env(login === "app" ? "DATABASE_URL" : "DATABASE_OWNER_URL");
  if (url) return { url };
  const host = env("DATABASE_HOST");
  const database = env("DATABASE_NAME");
  const user = login === "app" ? APP_LOGIN : env("DATABASE_OWNER_USERNAME");
  const password = env(login === "app" ? "DATABASE_PASSWORD" : "DATABASE_OWNER_PASSWORD");
  if (!host || !database || !user || !password) return null;
  const port = Number(env("DATABASE_PORT") ?? 5432);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("DATABASE_PORT is not a port number.");
  return { host, port, database, user, password };
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "host.docker.internal"]);

function parseAddress(address: DatabaseAddress) {
  if (!("url" in address)) return { host: address.host, port: address.port ?? 5432, user: address.user, password: address.password, database: address.database, sslmode: null };
  let url: URL;
  try {
    url = new URL(address.url);
  } catch {
    throw new Error("The database address is not a valid URL."); // never echo it: it holds the password
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") throw new Error("The database address must start with postgres://");
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 5432,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
    sslmode: url.searchParams.get("sslmode"),
  };
}

// Connection settings for the `pg` client. Built by hand rather than passed as a connection
// string, because `pg` lets a string's sslmode override the options given next to it.
// Connections are encrypted and the server's certificate is checked, except to a database
// on this machine or when the address says sslmode=disable (local development).
export function poolConfig(settings: DatabaseSettings, readFile: (path: string) => string = (path) => readFileSync(path, "utf8")): PoolConfig {
  const { host, port, user, password, database, sslmode } = parseAddress(settings);
  if (!host || !database) throw new Error("The database address needs a host and a database name.");

  if (settings.schema !== undefined && !/^[a-z_][a-z0-9_]*$/.test(settings.schema)) throw new Error("Not a schema name.");

  const plain = sslmode === "disable" || (LOCAL_HOSTS.has(host) && !sslmode);
  return {
    host,
    port,
    user,
    password,
    database,
    ssl: plain ? false : { rejectUnauthorized: true, ...(settings.caFile ? { ca: readFile(settings.caFile) } : {}) },
    max: settings.max ?? 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: settings.statementTimeoutMs ?? 60_000,
    application_name: settings.applicationName ?? "postsocial",
    options: `-c timezone=UTC${settings.schema ? ` -c search_path=${settings.schema}` : ""}`,
  };
}

// Dates come back the way they did on InsForge only when this process runs in UTC.
export function assertUtc(now: Date = new Date()) {
  if (now.getTimezoneOffset() !== 0) throw new Error("This service must run in UTC. Set TZ=UTC.");
}

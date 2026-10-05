// @vitest-environment node
//
// The rate-limit counter on the dev database: `npm run test:db`.
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createSql } from "../lib/insforge-admin";
import { resolveTarget } from "../../scripts/lib/accounts";
import { uniqueSuffix } from "./dev-backend";

const enabled = process.env.INSFORGE_INTEGRATION === "1";

describe.skipIf(!enabled)("rate limits on the dev backend", () => {
  const target = enabled ? resolveTarget("dev", path.resolve(__dirname, "../..")) : null!;
  const sql = enabled ? createSql(target.baseUrl, target.adminKey) : null!;
  const key = `test:${uniqueSuffix()}`;
  const take = async (limit: number, windowSeconds = 3600) => (await sql<{ wait: number }>(`SELECT public.take_rate_limit($1, $2, $3) AS wait`, [key, limit, windowSeconds]))[0].wait;

  afterAll(async () => {
    await sql(`DELETE FROM public.rate_limits WHERE key = $1`, [key]);
  });

  it("allows up to the limit, then says how long to wait", async () => {
    expect(await take(3)).toBe(0);
    expect(await take(3)).toBe(0);
    expect(await take(3)).toBe(0);
    const wait = await take(3);
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(3600);
  });

  it("refuses nonsense limits", async () => {
    await expect(take(0)).rejects.toThrow();
  });

  it("is closed to app clients", async () => {
    const [access] = await sql<Record<string, boolean>>(
      `SELECT has_table_privilege('anon', 'public.rate_limits', 'SELECT') AS anon_read,
              has_table_privilege('authenticated', 'public.rate_limits', 'INSERT') AS user_write,
              has_function_privilege('anon', 'public.take_rate_limit(text, integer, integer)', 'EXECUTE') AS anon_call,
              has_function_privilege('authenticated', 'public.take_rate_limit(text, integer, integer)', 'EXECUTE') AS user_call`,
      [],
    );
    expect(access).toEqual({ anon_read: false, user_write: false, anon_call: false, user_call: false });
  });
});

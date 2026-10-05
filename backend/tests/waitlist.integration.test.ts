// @vitest-environment node
//
// The landing page's waitlist on the dev database: `npm run test:db`.
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createSql } from "../lib/insforge-admin";
import { joinWaitlist } from "../lib/waitlist";
import { resolveTarget } from "../../scripts/lib/accounts";
import { uniqueSuffix } from "./dev-backend";

const enabled = process.env.INSFORGE_INTEGRATION === "1";

describe.skipIf(!enabled)("waitlist on the dev backend", () => {
  const target = enabled ? resolveTarget("dev", path.resolve(__dirname, "../..")) : null!;
  const sql = enabled ? createSql(target.baseUrl, target.adminKey) : null!;
  const email = `wait-${uniqueSuffix()}@postsocial.test`;

  afterAll(async () => {
    await sql(`DELETE FROM public.waitlist WHERE email = $1`, [email]);
  });

  it("stores the email once, lowercased, however often it is sent", async () => {
    await joinWaitlist(sql, { email: email.toUpperCase(), source: "landing" });
    await joinWaitlist(sql, { email, source: "again" });
    const rows = await sql<{ email: string; source: string }>(`SELECT email, source FROM public.waitlist WHERE email = $1`, [email]);
    expect(rows).toEqual([{ email, source: "landing" }]);
  });

  it("is closed to app clients", async () => {
    const [access] = await sql<Record<string, boolean>>(
      `SELECT has_table_privilege('anon', 'public.waitlist', 'SELECT') AS anon_read, has_table_privilege('anon', 'public.waitlist', 'INSERT') AS anon_write,
              has_table_privilege('authenticated', 'public.waitlist', 'SELECT') AS user_read, has_table_privilege('authenticated', 'public.waitlist', 'INSERT') AS user_write`,
      [],
    );
    expect(access).toEqual({ anon_read: false, anon_write: false, user_read: false, user_write: false });
  });

  it("refuses rows the database rules forbid", async () => {
    await expect(sql(`INSERT INTO public.waitlist (email) VALUES ('Not-Lower@x.com')`, [])).rejects.toThrow();
  });
});

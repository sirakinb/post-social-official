// @vitest-environment node
//
// X charges and plan switching on the dev database: `npm run test:db`.
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSql } from "../lib/insforge-admin";
import { provisionWorkspace } from "../lib/signup";
import { resolveTarget } from "../../scripts/lib/accounts";
import { api, uniqueSuffix } from "./dev-backend";

const enabled = process.env.INSFORGE_INTEGRATION === "1";

describe.skipIf(!enabled)("billing on the dev backend", () => {
  const target = enabled ? resolveTarget("dev", path.resolve(__dirname, "../..")) : null!;
  const sql = enabled ? createSql(target.baseUrl, target.adminKey) : null!;
  let userId = "";
  let workspaceId = "";
  const reserve = async (cents: number) => {
    const [row] = await sql<{ reserve_x_charge: string }>(`SELECT public.reserve_x_charge($1, $2, $3, false, 100)`, [randomUUID(), workspaceId, cents]);
    return row.reserve_x_charge;
  };

  beforeAll(async () => {
    const made = await api<{ user?: { id: string } }>(target.baseUrl, target.adminKey, "POST", "/api/auth/users?client_type=server", {
      email: `billing-${uniqueSuffix()}@postsocial.test`,
      password: `Billing-${uniqueSuffix()}-1`,
      name: "Billing Test",
    });
    userId = made.body.user!.id;
    workspaceId = (await provisionWorkspace(sql, { userId, displayName: "Billing Test", entryPoint: "ui" })).workspace_id;
  }, 60_000);

  afterAll(async () => {
    if (!userId) return;
    await sql(`DELETE FROM public.workspaces WHERE created_by = $1`, [userId]);
    await api(target.baseUrl, target.adminKey, "DELETE", "/api/auth/users", { userIds: [userId] });
  }, 60_000);

  it("stops a Free workspace's X posts at the free $1, and charges a post once", async () => {
    const destination = randomUUID();
    for (let i = 0; i < 2; i++) await sql(`SELECT public.reserve_x_charge($1, $2, 25, true, 100)`, [destination, workspaceId]);
    expect(await reserve(25)).toBe("ok");
    expect(await reserve(25)).toBe("ok");
    expect(await reserve(25)).toBe("ok");
    expect(await reserve(2)).toBe("over_cap");
    const [{ cents }] = await sql<{ cents: number }>(`SELECT sum(cents)::int AS cents FROM public.x_charges WHERE workspace_id = $1`, [workspaceId]);
    expect(cents).toBe(100);
  });

  it("lets a paying workspace go up to its own cap", async () => {
    await sql(
      `INSERT INTO public.workspace_billing (workspace_id, stripe_customer_id, stripe_subscription_id, subscription_status, x_monthly_cap_cents)
       VALUES ($1, $2, $3, 'active', 150)`,
      [workspaceId, `cus_test_${uniqueSuffix()}`, `sub_test_${uniqueSuffix()}`],
    );
    await sql(`SELECT public.set_billing_plan($1, true)`, [workspaceId]);
    expect(await reserve(25)).toBe("ok");
    expect(await reserve(25)).toBe("ok");
    expect(await reserve(2)).toBe("over_cap");
  });

  it("moves between Free and Paid but never touches Tester", async () => {
    await sql(`SELECT public.set_billing_plan($1, false)`, [workspaceId]);
    const plan = async () => (await sql<{ plan_id: string }>(`SELECT plan_id FROM public.workspace_plans WHERE workspace_id = $1`, [workspaceId]))[0].plan_id;
    expect(await plan()).toBe("free");
    await sql(`UPDATE public.workspace_plans SET plan_id = 'tester' WHERE workspace_id = $1`, [workspaceId]);
    await sql(`SELECT public.set_billing_plan($1, true)`, [workspaceId]);
    expect(await plan()).toBe("tester");
  });

  it("is closed to app clients", async () => {
    const [access] = await sql<{ anon: boolean; user: boolean; table: boolean }>(
      `SELECT has_function_privilege('anon', 'public.reserve_x_charge(uuid, uuid, integer, boolean, integer)', 'EXECUTE') AS anon,
              has_function_privilege('authenticated', 'public.set_billing_plan(uuid, boolean)', 'EXECUTE') AS user,
              has_table_privilege('authenticated', 'public.workspace_billing', 'SELECT') AS table`,
      [],
    );
    expect(access).toEqual({ anon: false, user: false, table: false });
  });
});

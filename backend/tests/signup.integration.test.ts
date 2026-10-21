// @vitest-environment node
//
// Open sign-up on the dev database: `npm run test:db`. A new sign-in gets exactly one
// workspace of its own on the Free plan, however often the app asks.
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createSql } from "../lib/insforge-admin";
import { provisionWorkspace } from "../lib/signup";
import { resolveTarget } from "../../scripts/lib/accounts";
import { api, uniqueSuffix } from "./dev-backend";

const enabled = process.env.INSFORGE_INTEGRATION === "1";

describe.skipIf(!enabled)("sign-up workspaces on the dev backend", () => {
  const target = enabled ? resolveTarget("dev", path.resolve(__dirname, "../..")) : null!;
  const sql = enabled ? createSql(target.baseUrl, target.adminKey) : null!;
  let userId = "";

  afterAll(async () => {
    if (!userId) return;
    await sql(`DELETE FROM public.workspaces WHERE created_by = $1`, [userId]);
    await api(target.baseUrl, target.adminKey, "DELETE", "/api/auth/users", { userIds: [userId] });
  }, 60_000);

  it("creates one Free workspace, even when asked twice at once", async () => {
    const made = await api<{ user?: { id: string } }>(target.baseUrl, target.adminKey, "POST", "/api/auth/users?client_type=server", {
      email: `signup-${uniqueSuffix()}@postsocial.test`,
      password: `Signup-${uniqueSuffix()}-1`,
      name: "Sign Up Test",
    });
    userId = made.body.user!.id;
    const caller = { userId, displayName: "Sign Up Test", entryPoint: "ui" as const };

    const [a, b] = await Promise.all([provisionWorkspace(sql, caller), provisionWorkspace(sql, caller)]);
    expect(a.workspace_id).toBe(b.workspace_id);
    expect(await provisionWorkspace(sql, caller)).toEqual(a);

    const rows = await sql<{ name: string; role: string; plan_id: string; actors: number }>(
      `SELECT w.name, m.role, p.plan_id,
              (SELECT count(*)::int FROM public.actors x WHERE x.workspace_id = w.id AND x.user_id = $1) AS actors
       FROM public.workspaces w
       JOIN public.workspace_members m ON m.workspace_id = w.id AND m.user_id = $1
       JOIN public.workspace_plans p ON p.workspace_id = w.id`,
      [userId],
    );
    expect(rows).toEqual([{ name: "Sign Up Test's workspace", role: "owner", plan_id: "free", actors: 1 }]);
  });

  it("is closed to app clients", async () => {
    const [access] = await sql<{ anon: boolean; user: boolean }>(
      `SELECT has_function_privilege('anon', 'public.provision_owner_workspace(uuid, text, text, text, text)', 'EXECUTE') AS anon,
              has_function_privilege('authenticated', 'public.provision_owner_workspace(uuid, text, text, text, text)', 'EXECUTE') AS user`,
      [],
    );
    expect(access).toEqual({ anon: false, user: false });
  });

  it("gives Free 2 connected accounts and Paid room to grow", async () => {
    const plans = await sql<{ id: string; max_connected_accounts: number }>(
      `SELECT id, max_connected_accounts FROM public.plans WHERE id IN ('free', 'paid') ORDER BY id`,
      [],
    );
    expect(plans).toEqual([{ id: "free", max_connected_accounts: 2 }, { id: "paid", max_connected_accounts: 2000 }]);
  });
});

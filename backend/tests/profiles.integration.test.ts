// @vitest-environment node
//
// Profiles on the dev database: `npm run test:db`. Checks the schema rules (one workspace
// per profile, unique names, members can only read) and the audited service calls.
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSql } from "../lib/insforge-admin";
import type { Caller } from "../lib/access";
import { createProfile, deleteProfile, listProfiles, moveAccount, updateProfile } from "../lib/connections/profiles";
import { createAccount, resolveTarget, type AccountResult } from "../../scripts/lib/accounts";
import { api, uniqueSuffix } from "./dev-backend";

const enabled = process.env.INSFORGE_INTEGRATION === "1";

describe.skipIf(!enabled)("profiles on the dev backend", () => {
  const target = enabled ? resolveTarget("dev", path.resolve(__dirname, "../..")) : null!;
  const sql = enabled ? createSql(target.baseUrl, target.adminKey) : null!;
  const suffix = uniqueSuffix();
  const password = `Profiles-${suffix}-pass-1`;
  let owner: AccountResult;
  let stranger: AccountResult;
  let account = "";
  let strangerProfile = "";
  const person = (who: AccountResult): Caller => ({ userId: who.userId, displayName: "Owner", entryPoint: "ui" });

  beforeAll(async () => {
    owner = await createAccount(target, { role: "owner", email: `profiles-${suffix}@postsocial.test`, displayName: "Owner", password, workspaceName: `Profiles ${suffix}` });
    stranger = await createAccount(target, { role: "owner", email: `profiles-other-${suffix}@postsocial.test`, displayName: "Other", password, workspaceName: `Profiles Other ${suffix}` });
    const [row] = await sql<{ id: string }>(
      `INSERT INTO public.connected_accounts (workspace_id, platform, external_account_id, handle, display_name, capabilities)
       VALUES ($1, 'x', $2, $2, 'Test X', '{}') RETURNING id`,
      [owner.workspaceId, `x-profiles-${suffix}`],
    );
    account = row.id;
    strangerProfile = (await createProfile(sql, person(stranger), { workspace_id: stranger.workspaceId, name: "Theirs" })).profile.id;
  }, 120_000);

  afterAll(async () => {
    for (const who of [owner, stranger].filter(Boolean)) {
      await api(target.baseUrl, target.adminKey, "DELETE", `/api/database/records/workspaces?id=eq.${who.workspaceId}`);
      await api(target.baseUrl, target.adminKey, "DELETE", "/api/auth/users", { userIds: [who.userId] });
    }
  }, 60_000);

  it("creates, renames, fills and deletes a profile, keeping its accounts", async () => {
    const { profile } = await createProfile(sql, person(owner), { workspace_id: owner.workspaceId, name: "Vibe Code Philly", color: "#3DD68C", timezone: "America/New_York" });
    await expect(createProfile(sql, person(owner), { workspace_id: owner.workspaceId, name: " vibe code philly " })).rejects.toMatchObject({ status: 409 });

    await updateProfile(sql, person(owner), { profile_id: profile.id, description: "Builders in Philly" });
    await moveAccount(sql, person(owner), { account_id: account, profile_id: profile.id });
    const listed = await listProfiles(sql, person(owner), { workspace_id: owner.workspaceId });
    expect(listed.profiles).toEqual([expect.objectContaining({ id: profile.id, description: "Builders in Philly", account_count: 1 })]);

    expect(await deleteProfile(sql, person(owner), { profile_id: profile.id })).toMatchObject({ accounts_moved: 1 });
    const [row] = await sql<{ profile_id: string | null; health: string }>(`SELECT profile_id, health FROM public.connected_accounts WHERE id = $1`, [account]);
    expect(row).toEqual({ profile_id: null, health: "connected" });

    const audit = await sql<{ event_type: string }>(`SELECT event_type FROM public.audit_events WHERE workspace_id = $1 AND entity_type IN ('profile', 'account') ORDER BY occurred_at`, [owner.workspaceId]);
    expect(audit.map((a) => a.event_type)).toEqual(["profile.created", "profile.updated", "account.moved", "profile.deleted"]);
  });

  it("never puts an account in another workspace's profile", async () => {
    await expect(moveAccount(sql, person(owner), { account_id: account, profile_id: strangerProfile })).rejects.toMatchObject({ status: 404 });
    await expect(updateProfile(sql, person(owner), { profile_id: strangerProfile, name: "Mine" })).rejects.toMatchObject({ status: 404 });
    // The database refuses it too, even for the server.
    await expect(sql(`UPDATE public.connected_accounts SET profile_id = $1 WHERE id = $2`, [strangerProfile, account])).rejects.toThrow();
  });

  it("lets members read their own profiles only, and never write them", async () => {
    const signIn = await api<{ accessToken?: string }>(target.baseUrl, "", "POST", "/api/auth/sessions?client_type=server", { email: `profiles-${suffix}@postsocial.test`, password });
    const token = signIn.body.accessToken!;
    const mine = await createProfile(sql, person(owner), { workspace_id: owner.workspaceId, name: "Still Meditation" });
    const read = await api<Array<{ id: string }>>(target.baseUrl, token, "GET", "/api/database/records/profiles?select=id");
    expect(read.body.map((p) => p.id)).toEqual([mine.profile.id]);
    const write = await api(target.baseUrl, token, "POST", "/api/database/records/profiles", [{ workspace_id: owner.workspaceId, name: "Sneaky" }]);
    expect(write.status).toBeGreaterThanOrEqual(400);
  });
});

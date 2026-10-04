// @vitest-environment node
//
// Runs against the InsForge dev branch: `npm run test:db`. Skipped by `npm test`.
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createAccount, resolveTarget, type AccountResult } from "../../scripts/lib/accounts";
import { api, uniqueSuffix } from "./dev-backend";

const enabled = process.env.INSFORGE_INTEGRATION === "1";

describe.skipIf(!enabled)("account script on the dev backend (US-012)", () => {
  const target = enabled ? resolveTarget("dev", path.resolve(__dirname, "../..")) : null!;
  const suffix = uniqueSuffix();
  const password = `Account-${suffix}-9`;
  const ownerEmail = `account-owner-${suffix}@postsocial.test`;
  const reviewerEmail = `account-reviewer-${suffix}@postsocial.test`;
  const created: AccountResult[] = [];

  async function signIn(email: string) {
    const result = await api<{ accessToken?: string }>(target.baseUrl, "", "POST", "/api/auth/sessions?client_type=server", {
      email,
      password,
    });
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    return result.body.accessToken!;
  }

  afterAll(async () => {
    const workspaceIds = [...new Set(created.map((c) => c.workspaceId))];
    if (workspaceIds.length) {
      const deleted = await api(target.baseUrl, target.adminKey, "DELETE", `/api/database/records/workspaces?id=in.(${workspaceIds.join(",")})`);
      expect(deleted.status).toBeLessThan(300);
    }
    const userIds = created.map((c) => c.userId);
    if (userIds.length) {
      const removed = await api(target.baseUrl, target.adminKey, "DELETE", "/api/auth/users", { userIds });
      expect(removed.status).toBeLessThan(300);
    }
  }, 60_000);

  it("creates an owner who can sign in and see their new workspace", async () => {
    const owner = await createAccount(target, {
      role: "owner",
      email: ownerEmail,
      displayName: "Test Owner",
      password,
      workspaceName: `Account Test ${suffix}`,
    });
    created.push(owner);

    const token = await signIn(ownerEmail);
    const memberships = await api<Array<{ role: string; workspaces: { slug: string } }>>(
      target.baseUrl,
      token,
      "GET",
      "/api/database/records/workspace_members?select=role,workspaces(slug)",
    );
    expect(memberships.body).toEqual([{ role: "owner", workspaces: { slug: owner.workspaceSlug } }]);

    const audit = await api<Array<{ event_type: string }>>(
      target.baseUrl,
      token,
      "GET",
      `/api/database/records/audit_events?workspace_id=eq.${owner.workspaceId}&select=event_type`,
    );
    expect(audit.body).toEqual([{ event_type: "workspace.created" }]);
  });

  it("adds a reviewer to an existing workspace", async () => {
    const owner = created[0];
    const reviewer = await createAccount(target, {
      role: "reviewer",
      email: reviewerEmail,
      displayName: "Test Reviewer",
      password,
      workspaceSlug: owner.workspaceSlug,
    });
    created.push(reviewer);
    expect(reviewer.workspaceId).toBe(owner.workspaceId);

    const token = await signIn(reviewerEmail);
    const memberships = await api<Array<{ role: string }>>(
      target.baseUrl,
      token,
      "GET",
      "/api/database/records/workspace_members?select=role&user_id=eq." + reviewer.userId,
    );
    expect(memberships.body).toEqual([{ role: "reviewer" }]);
  });

  it("refuses a duplicate workspace address or an unknown one before creating a sign-in", async () => {
    const owner = created[0];
    await expect(
      createAccount(target, {
        role: "owner",
        email: `account-dup-${suffix}@postsocial.test`,
        displayName: "Dup",
        password,
        workspaceName: "Whatever",
        workspaceSlug: owner.workspaceSlug,
      }),
    ).rejects.toThrow(/already exists/);

    await expect(
      createAccount(target, {
        role: "reviewer",
        email: `account-none-${suffix}@postsocial.test`,
        displayName: "None",
        password,
        workspaceSlug: `missing-${suffix}`,
      }),
    ).rejects.toThrow(/No workspace/);

    const users = await api<{ data?: Array<{ email: string }> }>(
      target.baseUrl,
      target.adminKey,
      "GET",
      `/api/auth/users?limit=10&search=${suffix}`,
    );
    const emails = (users.body.data ?? []).map((u) => u.email).sort();
    expect(emails).toEqual([ownerEmail, reviewerEmail].sort());
  });

  it("refuses an email that already has a sign-in", async () => {
    const owner = created[0];
    // A second sign-in with the owner's email is refused by the auth service itself.
    await expect(
      createAccount(target, {
        role: "reviewer",
        email: ownerEmail,
        displayName: "Again",
        password,
        workspaceSlug: owner.workspaceSlug,
      }),
    ).rejects.toThrow(/Could not create the sign-in/);
  });
});

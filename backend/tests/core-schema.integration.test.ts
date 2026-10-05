// @vitest-environment node
//
// Runs against the InsForge dev branch: `npm run test:db`. Skipped by `npm test`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, devBackend, uniqueSuffix } from "./dev-backend";

const enabled = process.env.INSFORGE_INTEGRATION === "1";

type Row = Record<string, unknown> & { id: string };

describe.skipIf(!enabled)("core schema on the dev backend", () => {
  const { baseUrl, adminKey } = enabled ? devBackend() : { baseUrl: "", adminKey: "" };
  const suffix = uniqueSuffix();
  const password = `Test-${suffix}-Aa1!`;

  const admin = <T = unknown>(method: string, p: string, body?: unknown) =>
    api<T>(baseUrl, adminKey, method, p, body);
  const records = (table: string, query = "") => `/api/database/records/${table}${query}`;

  async function insert(table: string, row: Record<string, unknown>): Promise<Row> {
    const result = await admin<Row[]>("POST", records(table), [row]);
    if (result.status >= 300) {
      throw new Error(`insert into ${table} failed: ${result.status} ${JSON.stringify(result.body)}`);
    }
    return result.body[0];
  }

  async function createUser(label: string) {
    const email = `schema-test-${label}-${suffix}@postsocial.test`;
    const result = await admin<{ user: { id: string }; accessToken: string }>(
      "POST",
      "/api/auth/users?client_type=server",
      { email, password },
    );
    if (result.status !== 200 || !result.body.accessToken) {
      throw new Error(`could not create test user: ${result.status} ${JSON.stringify(result.body)}`);
    }
    return { id: result.body.user.id, token: result.body.accessToken };
  }

  let userA: { id: string; token: string };
  let userB: { id: string; token: string };
  let workspaceA: Row;
  let workspaceB: Row;
  let accountA: Row;
  let postA: Row;
  let postB: Row;
  let apiKeyActor: Row;

  const asA = <T = unknown>(method: string, p: string, body?: unknown) =>
    api<T>(baseUrl, userA.token, method, p, body);

  beforeAll(async () => {
    userA = await createUser("a");
    userB = await createUser("b");

    // Publishing paused: the always-on dev worker must never pick up this test's jobs.
    workspaceA = await insert("workspaces", { name: "Workspace A", slug: `ws-a-${suffix}`, created_by: userA.id, publishing_paused: true });
    workspaceB = await insert("workspaces", { name: "Workspace B", slug: `ws-b-${suffix}`, created_by: userB.id, publishing_paused: true });
    await insert("workspace_members", { workspace_id: workspaceA.id, user_id: userA.id, role: "owner" });
    await insert("workspace_members", { workspace_id: workspaceB.id, user_id: userB.id, role: "owner" });

    accountA = await insert("connected_accounts", {
      workspace_id: workspaceA.id,
      platform: "instagram",
      external_account_id: `ig-${suffix}`,
      handle: "test_handle",
      display_name: "Test Account",
    });
    await insert("credentials", {
      workspace_id: workspaceA.id,
      connected_account_id: accountA.id,
      encrypted_payload: "ciphertext",
      initialization_vector: "iv",
      key_version: 1,
    });
    const apiKey = await insert("api_keys", {
      workspace_id: workspaceA.id,
      created_by: userA.id,
      name: "Zapier",
      key_prefix: "ps_test_abc",
      key_hash: `hash-${suffix}`,
      mode: "test",
    });
    apiKeyActor = await insert("actors", {
      workspace_id: workspaceA.id,
      kind: "api_key",
      api_key_id: apiKey.id,
      display_name: "Zapier key",
    });

    postA = await insert("posts", {
      workspace_id: workspaceA.id,
      actor_id: apiKeyActor.id,
      entry_point: "api",
      caption: "Post in A",
      effective_approval_policy: "confirm_each",
    });
    postB = await insert("posts", {
      workspace_id: workspaceB.id,
      entry_point: "ui",
      caption: "Post in B",
      effective_approval_policy: "confirm_each",
    });
    // Media in use by a post: deleting the workspace must still succeed (see afterAll).
    const media = await insert("media_assets", {
      workspace_id: workspaceA.id,
      storage_key: `test/${suffix}/clip.mp4`,
      file_name: "clip.mp4",
      mime_type: "video/mp4",
      media_type: "video",
      size_bytes: 1024,
    });
    await insert("post_media", { post_id: postA.id, media_asset_id: media.id, workspace_id: workspaceA.id, position: 0 });

    await insert("audit_events", {
      workspace_id: workspaceA.id,
      actor_id: apiKeyActor.id,
      entry_point: "api",
      event_type: "post.created",
      entity_type: "post",
      entity_id: postA.id,
      summary: "Created a draft post",
      after_values: { caption: "Post in A" },
    });
  }, 60_000);

  afterAll(async () => {
    const workspaceIds = [workspaceA?.id, workspaceB?.id].filter(Boolean);
    if (workspaceIds.length) {
      // Audit rows are append-only by trigger, so they go away only with their workspace.
      // This also proves a full workspace deletion works with every kind of child row.
      const deleted = await admin<Row[]>("DELETE", records("workspaces", `?id=in.(${workspaceIds.join(",")})`));
      expect(deleted.status, JSON.stringify(deleted.body)).toBe(200);
      expect(deleted.body).toHaveLength(workspaceIds.length);
    }
    const userIds = [userA?.id, userB?.id].filter(Boolean);
    if (userIds.length) {
      const removed = await admin("DELETE", "/api/auth/users", { userIds });
      expect(removed.status, JSON.stringify(removed.body)).toBeLessThan(300);
    }
  }, 60_000);

  describe("workspace isolation (US-005)", () => {
    it("a member sees only their own workspace", async () => {
      const result = await asA<Row[]>("GET", records("workspaces"));
      expect(result.status).toBe(200);
      expect(result.body.map((w) => w.id)).toEqual([workspaceA.id]);
    });

    it("a member of workspace A cannot read workspace B's posts, even by asking for them", async () => {
      const all = await asA<Row[]>("GET", records("posts"));
      expect(all.body.map((p) => p.id)).toEqual([postA.id]);

      const targeted = await asA<Row[]>("GET", records("posts", `?workspace_id=eq.${workspaceB.id}`));
      expect(targeted.body).toEqual([]);
      const byId = await asA<Row[]>("GET", records("posts", `?id=eq.${postB.id}`));
      expect(byId.body).toEqual([]);
    });

    it("app clients cannot write directly, even to their own workspace", async () => {
      const create = await asA("POST", records("posts"), [
        { workspace_id: workspaceA.id, entry_point: "ui", caption: "x", effective_approval_policy: "autonomous" },
      ]);
      expect(create.status).toBeGreaterThanOrEqual(400);

      const update = await asA<Row[]>("PATCH", records("posts", `?id=eq.${postA.id}`), { caption: "changed" });
      expect(update.status).toBeGreaterThanOrEqual(400);

      const membership = await asA("POST", records("workspace_members"), [
        { workspace_id: workspaceB.id, user_id: userA.id, role: "owner" },
      ]);
      expect(membership.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe("credentials stay server-only (US-006)", () => {
    it("the web app client cannot select from credentials", async () => {
      const result = await asA<Row[]>("GET", records("credentials"));
      expect(result.status).toBeGreaterThanOrEqual(400);
    });

    it("the web app client cannot read API key hashes", async () => {
      const hashes = await asA("GET", records("api_keys", "?select=key_hash"));
      expect(hashes.status).toBeGreaterThanOrEqual(400);

      const safe = await asA<Row[]>("GET", records("api_keys", "?select=id,name,key_prefix"));
      expect(safe.status).toBe(200);
      expect(safe.body).toHaveLength(1);
      expect(safe.body[0].name).toBe("Zapier");
    });
  });

  describe("publishing model (US-007)", () => {
    it("rejects impossible post transitions and allows valid ones", async () => {
      const skip = await admin("PATCH", records("posts", `?id=eq.${postA.id}`), { status: "published" });
      expect(skip.status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(skip.body)).toContain("Invalid post transition");

      const toApproval = await admin<Row[]>("PATCH", records("posts", `?id=eq.${postA.id}`), {
        status: "awaiting_approval",
      });
      expect(toApproval.status).toBe(200);
      const approve = await admin<Row[]>("PATCH", records("posts", `?id=eq.${postA.id}`), { status: "approved" });
      expect(approve.status).toBe(200);
      // A caption edit after approval sends the post back for approval.
      const back = await admin<Row[]>("PATCH", records("posts", `?id=eq.${postA.id}`), {
        status: "awaiting_approval",
      });
      expect(back.status).toBe(200);
    });

    it("never allows two publish jobs with the same idempotency key, or two live jobs per destination", async () => {
      const destination = await insert("destinations", {
        workspace_id: workspaceA.id,
        post_id: postA.id,
        connected_account_id: accountA.id,
        platform: "instagram",
        effective_approval_policy: "confirm_each",
      });
      const job = {
        workspace_id: workspaceA.id,
        post_id: postA.id,
        destination_id: destination.id,
        idempotency_key: `idem-${suffix}`,
      };
      await insert("publish_jobs", job);

      const sameKey = await admin("POST", records("publish_jobs"), [job]);
      expect(sameKey.status).toBe(409);

      const secondLive = await admin("POST", records("publish_jobs"), [{ ...job, idempotency_key: `idem2-${suffix}` }]);
      expect(secondLive.status).toBe(409);
    });
  });

  describe("workspace integrity", () => {
    it("rejects a destination that mixes a post and an account from different workspaces", async () => {
      const mixed = await admin("POST", records("destinations"), [
        {
          workspace_id: workspaceA.id,
          post_id: postB.id,
          connected_account_id: accountA.id,
          platform: "instagram",
          effective_approval_policy: "confirm_each",
        },
      ]);
      expect(mixed.status).toBeGreaterThanOrEqual(400);
    });

    it("rejects a post attributed to another workspace's actor", async () => {
      const foreignActor = await admin("POST", records("posts"), [
        {
          workspace_id: workspaceB.id,
          actor_id: apiKeyActor.id,
          entry_point: "api",
          effective_approval_policy: "confirm_each",
        },
      ]);
      expect(foreignActor.status).toBeGreaterThanOrEqual(400);
    });

    it("does not let a connected account with posts be deleted on its own", async () => {
      const removal = await admin("DELETE", records("connected_accounts", `?id=eq.${accountA.id}`));
      expect(removal.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe("who did it (US-008)", () => {
    it("the audit log names the API key that created a post", async () => {
      const result = await asA<Array<{ summary: string; actors: { display_name: string; kind: string } }>>(
        "GET",
        records("audit_events", `?entity_id=eq.${postA.id}&select=summary,actors(display_name,kind)`),
      );
      expect(result.status).toBe(200);
      expect(result.body).toEqual([
        { summary: "Created a draft post", actors: { display_name: "Zapier key", kind: "api_key" } },
      ]);
    });

    it("the audit log is append-only, even for the server", async () => {
      const edit = await admin("PATCH", records("audit_events", `?entity_id=eq.${postA.id}`), { summary: "rewritten" });
      expect(edit.status).toBeGreaterThanOrEqual(400);
      const removal = await admin("DELETE", records("audit_events", `?entity_id=eq.${postA.id}`));
      expect(removal.status).toBeGreaterThanOrEqual(400);
    });

    it("an actor's kind must match the identity it points to", async () => {
      const mismatched = await admin("POST", records("actors"), [
        { workspace_id: workspaceA.id, kind: "user", api_key_id: apiKeyActor.api_key_id, display_name: "bad" },
      ]);
      expect(mismatched.status).toBeGreaterThanOrEqual(400);
    });

    it("an API key actor must point at a key when created", async () => {
      const missing = await admin("POST", records("actors"), [
        { workspace_id: workspaceA.id, kind: "api_key", display_name: "No key" },
      ]);
      expect(missing.status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(missing.body)).toContain("must point at its API key");
    });

    it("an actor cannot be re-pointed or change kind", async () => {
      const rekind = await admin("PATCH", records("actors", `?id=eq.${apiKeyActor.id}`), { kind: "system" });
      expect(rekind.status).toBeGreaterThanOrEqual(400);
      const rename = await admin<Row[]>("PATCH", records("actors", `?id=eq.${apiKeyActor.id}`), {
        display_name: "Zapier key",
      });
      expect(rename.status).toBe(200);
    });
  });

  describe("usage and limits (US-010)", () => {
    it("returns current-period usage only for the caller's own workspace", async () => {
      await insert("usage_events", { workspace_id: workspaceA.id, event_type: "post_published", quantity: 2 });
      await insert("usage_events", { workspace_id: workspaceA.id, event_type: "post_published", quantity: 1 });
      await insert("usage_events", { workspace_id: workspaceB.id, event_type: "post_published", quantity: 7 });

      const own = await asA<Array<{ event_type: string; quantity: number }>>(
        "POST",
        "/api/database/rpc/workspace_usage",
        { target_workspace: workspaceA.id },
      );
      expect(own.status).toBe(200);
      expect(own.body).toEqual([{ event_type: "post_published", quantity: 3 }]);

      const other = await asA<unknown[]>("POST", "/api/database/rpc/workspace_usage", {
        target_workspace: workspaceB.id,
      });
      expect(other.body).toEqual([]);
    });

    it("explains in plain language when a plan limit would be exceeded", async () => {
      const within = await admin("POST", "/api/database/rpc/assert_within_limit", {
        target_workspace: workspaceA.id,
        limit_name: "connected_accounts",
        adding: 1,
      });
      expect(within.status).toBeLessThan(300);

      const over = await admin("POST", "/api/database/rpc/assert_within_limit", {
        target_workspace: workspaceA.id,
        limit_name: "connected_accounts",
        adding: 1000,
      });
      expect(over.status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(over.body)).toContain("Your Tester plan allows 50 connected accounts. You have used 1");
    });

    it("app clients cannot call the limit check directly", async () => {
      const result = await asA("POST", "/api/database/rpc/assert_within_limit", {
        target_workspace: workspaceA.id,
        limit_name: "connected_accounts",
      });
      expect(result.status).toBeGreaterThanOrEqual(400);
    });
  });
});

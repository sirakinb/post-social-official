// @vitest-environment node
//
// Calls the deployed `media` function on the dev branch with real sign-ins:
// `npm run test:db`. Skipped by `npm test`.
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAccount, resolveTarget, type AccountResult } from "../../scripts/lib/accounts";
import { api, uniqueSuffix } from "./dev-backend";

const enabled = process.env.INSFORGE_INTEGRATION === "1";

type Json = Record<string, unknown>;

describe.skipIf(!enabled)("media function on the dev backend (US-013, US-014, US-015)", () => {
  const target = enabled ? resolveTarget("dev", path.resolve(__dirname, "../..")) : null!;
  const suffix = uniqueSuffix();
  const password = `Media-${suffix}-9`;
  const created: AccountResult[] = [];
  let ownerToken = "";
  let reviewerToken = "";
  let outsiderToken = "";
  let workspaceId = "";

  const media = (token: string, body: Json) => api<Json>(target.baseUrl, token, "POST", "/functions/media", body);

  async function signIn(email: string) {
    const result = await api<{ accessToken?: string }>(target.baseUrl, "", "POST", "/api/auth/sessions?client_type=server", { email, password });
    expect(result.status).toBe(200);
    return result.body.accessToken!;
  }

  beforeAll(async () => {
    const owner = await createAccount(target, {
      role: "owner",
      email: `media-owner-${suffix}@postsocial.test`,
      displayName: "Media Owner",
      password,
      workspaceName: `Media Test ${suffix}`,
    });
    created.push(owner);
    workspaceId = owner.workspaceId;
    created.push(
      await createAccount(target, {
        role: "reviewer",
        email: `media-reviewer-${suffix}@postsocial.test`,
        displayName: "Media Reviewer",
        password,
        workspaceSlug: owner.workspaceSlug,
      }),
    );
    created.push(
      await createAccount(target, {
        role: "owner",
        email: `media-outsider-${suffix}@postsocial.test`,
        displayName: "Outsider",
        password,
        workspaceName: `Media Outsider ${suffix}`,
      }),
    );
    ownerToken = await signIn(`media-owner-${suffix}@postsocial.test`);
    reviewerToken = await signIn(`media-reviewer-${suffix}@postsocial.test`);
    outsiderToken = await signIn(`media-outsider-${suffix}@postsocial.test`);
  }, 120_000);

  afterAll(async () => {
    const ids = [...new Set(created.map((c) => c.workspaceId))];
    if (ids.length) {
      const deleted = await api(target.baseUrl, target.adminKey, "DELETE", `/api/database/records/workspaces?id=in.(${ids.join(",")})`);
      expect(deleted.status).toBeLessThan(300);
    }
    const userIds = created.map((c) => c.userId);
    if (userIds.length) expect((await api(target.baseUrl, target.adminKey, "DELETE", "/api/auth/users", { userIds })).status).toBeLessThan(300);
  }, 120_000);

  it("refuses callers who are not signed in", async () => {
    const result = await media("", { action: "get", media_id: crypto.randomUUID() });
    expect(result.status).toBe(401);
  });

  let uploadedId = "";

  it("uploads a file in parts straight to storage, then queues it for checking", async () => {
    const bytes = new Uint8Array(9 * 1024 * 1024).fill(7); // two parts at the 8 MiB minimum
    const start = await media(ownerToken, {
      action: "create_upload",
      workspace_id: workspaceId,
      file_name: "My Clip (final).mp4",
      mime_type: "video/mp4",
      size_bytes: bytes.length,
    });
    expect(start.status, JSON.stringify(start.body)).toBe(200);
    const parts = start.body.parts as Array<{ part_number: number; url: string }>;
    const partSize = start.body.part_size as number;
    expect(parts).toHaveLength(2);

    const etags = [];
    for (const part of parts) {
      const chunk = bytes.slice((part.part_number - 1) * partSize, part.part_number * partSize);
      const put = await fetch(part.url, { method: "PUT", body: chunk });
      expect(put.status).toBe(200);
      etags.push({ part_number: part.part_number, etag: put.headers.get("etag") });
    }

    const done = await media(ownerToken, { action: "complete_upload", media_id: start.body.media_id, parts: etags });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body).toMatchObject({ status: "processing", size_bytes: bytes.length, name: "My-Clip-final-.mp4", media_type: "video" });
    uploadedId = String(start.body.media_id);

    const jobs = await api<Array<{ kind: string; state: string }>>(
      target.baseUrl,
      ownerToken,
      "GET",
      `/api/database/records/media_jobs?media_asset_id=eq.${uploadedId}&select=kind,state`,
    );
    expect(jobs.body).toEqual([{ kind: "probe", state: "queued" }]);

    const again = await media(ownerToken, { action: "complete_upload", media_id: uploadedId, parts: etags });
    expect(again.status).toBe(409);
  });

  it("rejects unsupported files and files over 1 GB before anything is stored", async () => {
    const pdf = await media(ownerToken, { action: "create_upload", workspace_id: workspaceId, file_name: "a.pdf", mime_type: "application/pdf", size_bytes: 10 });
    expect(pdf.status).toBe(400);
    expect(pdf.body.error).toMatch(/not supported/);
    const huge = await media(ownerToken, { action: "create_upload", workspace_id: workspaceId, file_name: "a.mp4", mime_type: "video/mp4", size_bytes: 2 * 1024 ** 3 });
    expect(huge.status).toBe(400);
    expect(huge.body.error).toMatch(/at most 1 GB/);
  });

  it("refuses to finish an upload whose parts were never sent", async () => {
    const start = await media(ownerToken, { action: "create_upload", workspace_id: workspaceId, file_name: "b.mp4", mime_type: "video/mp4", size_bytes: 1000 });
    const finish = await media(ownerToken, { action: "complete_upload", media_id: start.body.media_id, parts: [{ part_number: 1, etag: '"fake"' }] });
    expect(finish.status).toBe(409);
    const cancel = await media(ownerToken, { action: "abort_upload", media_id: start.body.media_id });
    expect(cancel.body).toMatchObject({ status: "cancelled" });
    const gone = await media(ownerToken, { action: "get", media_id: start.body.media_id });
    expect(gone.status).toBe(404);
  });

  it("renames and hides media, and records who did it", async () => {
    const renamed = await media(ownerToken, { action: "rename", media_id: uploadedId, name: "Launch teaser" });
    expect(renamed.body).toMatchObject({ name: "Launch teaser" });
    const hidden = await media(ownerToken, { action: "set_hidden", media_id: uploadedId, hidden: true });
    expect(hidden.body).toMatchObject({ hidden: true });

    const audit = await api<Array<{ event_type: string; actors: { display_name: string } }>>(
      target.baseUrl,
      ownerToken,
      "GET",
      `/api/database/records/audit_events?entity_id=eq.${uploadedId}&select=event_type,actors(display_name)&order=occurred_at.asc`,
    );
    expect(audit.body.map((a) => a.event_type)).toEqual(["media.uploaded", "media.renamed", "media.hidden"]);
    expect(new Set(audit.body.map((a) => a.actors.display_name))).toEqual(new Set(["Media Owner"]));
  });

  it("lets reviewers look but not change anything", async () => {
    const look = await media(reviewerToken, { action: "get", media_id: uploadedId });
    expect(look.status).toBe(200);
    const change = await media(reviewerToken, { action: "rename", media_id: uploadedId, name: "nope" });
    expect(change.status).toBe(403);
  });

  it("does not reveal media or workspaces to people outside them", async () => {
    const look = await media(outsiderToken, { action: "get", media_id: uploadedId });
    expect(look.status).toBe(404);
    const upload = await media(outsiderToken, { action: "create_upload", workspace_id: workspaceId, file_name: "x.mp4", mime_type: "video/mp4", size_bytes: 10 });
    expect(upload.status).toBe(404);
  });

  it("accepts https links for import and rejects unsafe ones with a clear reason", async () => {
    const ok = await media(ownerToken, { action: "import", workspace_id: workspaceId, url: "https://example.com/videos/clip.mp4" });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ status: "processing", name: "clip.mp4" });

    for (const [url, reason] of [
      ["http://example.com/a.mp4", /Only https/],
      ["https://127.0.0.1/a.mp4", /private or local/],
      ["https://169.254.169.254/latest/meta-data", /private or local/],
      ["https://localhost/a.mp4", /private or local/],
      ["https://user:pass@example.com/a.mp4", /username or password/],
      ["not a url", /not a valid link/],
    ] as const) {
      const bad = await media(ownerToken, { action: "import", workspace_id: workspaceId, url });
      expect(bad.status, url).toBe(400);
      expect(String(bad.body.error), url).toMatch(reason);
    }
  });
});

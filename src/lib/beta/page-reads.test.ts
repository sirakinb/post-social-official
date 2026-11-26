// @vitest-environment node
//
// The drafts list and the activity log reading through our API (PAGE_READS=api).
import { beforeEach, describe, expect, it, vi } from "vitest";

// What the pages pass in: callServer from ./workspace.
const server = { callServer: vi.fn() };
const api = ((action: string, body: Record<string, unknown>) => server.callServer(action, body)) as never;

import { DRAFTS_LIMIT, loadDrafts } from "./drafts";
import { loadLogs } from "./logs";

const untouched = { database: { from: vi.fn(() => { throw new Error("the database was read directly"); }) } } as never;

beforeEach(() => server.callServer.mockReset());

describe("drafts through our API", () => {
  const draft = (id: string) => ({ id, caption: "c", scheduled_at: null, updated_at: "2031-03-01T10:00:00+00:00", entry_point: "ui", actors: null, destinations: [], post_media: [] });

  it("asks for one more than it shows, so the page knows there are more", async () => {
    server.callServer.mockResolvedValue({ posts: Array.from({ length: DRAFTS_LIMIT + 1 }, (_, i) => draft(`d${i}`)) });
    const result = await loadDrafts(untouched, "w1", api);
    expect(server.callServer).toHaveBeenCalledWith("drafts_page", { workspace_id: "w1", limit: DRAFTS_LIMIT + 1 });
    expect([result.rows.length, result.hasMore, result.failed]).toEqual([DRAFTS_LIMIT, true, false]);
  });

  it("says the read failed, rather than showing an empty list as if there were no drafts", async () => {
    server.callServer.mockResolvedValue(null);
    expect(await loadDrafts(untouched, "w1", api)).toEqual({ rows: [], hasMore: false, failed: true });
  });
});

describe("the activity log through our API", () => {
  const event = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ id, occurred_at: "2031-03-02T10:00:00+00:00", event_type: type, entry_point: "system", entity_type: "post", entity_id: null, summary: "s", before_values: null, after_values: null, metadata: null, actors: null, ...extra });

  it("sends the page's filters and credits a publishing step to whoever made the post", async () => {
    server.callServer.mockResolvedValue({
      events: [event("e1", "destination.failed", { entity_type: "destination", entity_id: "d1" }), event("e2", "post.created"), event("e3", "post.created")],
      destinations: [{ id: "d1", platform: "x", post_id: "p1", connected_account_id: "a1", status: "failed", may_be_live: false, connected_accounts: { display_name: "Ben X" }, actors: { kind: "user", display_name: "Ben" } }],
      people: [{ id: "actor-1", display_name: "Ben" }],
    });
    const result = await loadLogs(untouched, "w1", { level: "errors", area: "posts", source: "system", actorId: "00000000-0000-4000-8000-000000000001", before: "2031-04-01T00:00:00Z" }, 2, api);
    expect(server.callServer).toHaveBeenCalledWith("activity_page", {
      workspace_id: "w1",
      event_types: ["destination.failed", "media.failed", "account.refresh_failed", "account.deauthorized", "media.expired"],
      prefixes: ["post.", "destination."],
      source: "system",
      actor_id: "00000000-0000-4000-8000-000000000001",
      before: "2031-04-01T00:00:00Z",
      limit: 3,
    });
    expect([result.logs.length, result.hasMore, result.failed]).toEqual([2, true, false]);
    expect(result.logs[0]).toMatchObject({ id: "e1", level: "error", actorKind: "user", actorName: "Ben", target: { platform: "x", account: "Ben X", postId: "p1", accountId: "a1", status: "failed", mayBeLive: false } });
    expect(result.logs[1]).toMatchObject({ id: "e2", actorKind: "system", actorName: "Post Social", target: null });
    expect(result.people).toEqual([{ id: "actor-1", display_name: "Ben" }]);
  });

  it("sends no filters it wasn't given", async () => {
    server.callServer.mockResolvedValue({ events: [], destinations: [], people: [] });
    await loadLogs(untouched, "w1", { level: "all", area: null, source: null, actorId: null, before: null }, 50, api);
    expect(server.callServer).toHaveBeenCalledWith("activity_page", { workspace_id: "w1", limit: 51 });
  });

  it("says the read failed when it doesn't come back", async () => {
    server.callServer.mockResolvedValue(null);
    expect(await loadLogs(untouched, "w1", { level: "all", area: null, source: null, actorId: null, before: null }, 50, api)).toMatchObject({ logs: [], hasMore: false, failed: true, people: null });
  });
});

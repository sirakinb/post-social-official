import { describe, expect, it } from "vitest";
import type { Sql } from "../../../backend/lib/access";
import { runNextPublishJob } from "./runner";
import type { Adapter } from "./types";

// A stand-in database that answers the runner's reads and records every statement it sends.
function fakeDatabase() {
  const statements: { text: string; params: unknown[] }[] = [];
  const sql = (async (text: string, params: unknown[] = []) => {
    statements.push({ text: text.replace(/\s+/g, " ").trim(), params });
    if (text.includes("claim_publish_job")) {
      return [{ id: "job-1", workspace_id: "ws-1", post_id: "post-1", destination_id: "dest-1", attempt_count: 1, poll_count: 0, max_attempts: 3, checkpoint: {}, started_at: new Date().toISOString() }];
    }
    if (text.includes("FROM public.destinations d JOIN public.posts p")) {
      return [{ status: "scheduled", post_status: "scheduled", platform: "facebook", options: { media_type: "text" }, caption: "Hello", account_id: "acct-1", external_account_id: "fb-1", handle: "page", display_name: "Page", scopes: [], capabilities: {}, health: "connected" }];
    }
    return [];
  }) as Sql;
  return { sql, statements };
}

describe("runNextPublishJob", () => {
  it("moves a scheduled post to sending in a statement Postgres actually runs, so it can finish as published", async () => {
    const db = fakeDatabase();
    const adapter: Adapter = async () => ({ kind: "published", platformId: "fb-post-1", liveUrl: "https://facebook.com/fb-post-1" });
    expect(await runNextPublishJob({ sql: db.sql, r2: {} as never, setting: () => "", adapters: { facebook: adapter } })).toBe(true);

    // Postgres skips a WITH query that the main statement never reads, so the call must be
    // its own statement; otherwise the post stays "scheduled" and finalize_post ignores it.
    const marks = db.statements.filter((s) => s.text.includes("mark_post_sending"));
    expect(marks).toEqual([{ text: "SELECT public.mark_post_sending($1)", params: ["post-1"] }]);
    const order = db.statements.map((s) => s.text);
    const marked = order.indexOf("SELECT public.mark_post_sending($1)");
    const finalized = order.indexOf("SELECT public.finalize_post($1)");
    expect(marked).toBeGreaterThan(-1);
    expect(finalized).toBeGreaterThan(marked);
  });
});

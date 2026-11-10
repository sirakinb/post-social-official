import { describe, expect, it } from "vitest";
import type { Sql } from "../../../backend/lib/access";
import { runNextPublishJob } from "./runner";
import { PublishError, type Adapter } from "./types";

// A stand-in database that answers the runner's reads and records every statement it sends.
function fakeDatabase(startedAt = new Date().toISOString()) {
  const statements: { text: string; params: unknown[] }[] = [];
  const sql = (async (text: string, params: unknown[] = []) => {
    statements.push({ text: text.replace(/\s+/g, " ").trim(), params });
    if (text.includes("claim_publish_job")) {
      return [{ id: "job-1", workspace_id: "ws-1", post_id: "post-1", destination_id: "dest-1", attempt_count: 1, poll_count: 0, max_attempts: 3, checkpoint: {}, started_at: startedAt }];
    }
    if (text.includes("FROM public.destinations d JOIN public.posts p")) {
      return [{ status: "scheduled", post_status: "scheduled", platform: "facebook", options: { media_type: "text" }, caption: "Hello", account_id: "acct-1", external_account_id: "fb-1", handle: "page", display_name: "Page", scopes: [], capabilities: {}, health: "connected" }];
    }
    if (text.includes("SET checkpoint")) return [{ id: "job-1" }];
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

  it("gives up after 30 minutes of waiting with a readable message", async () => {
    const db = fakeDatabase(new Date(Date.now() - 31 * 60_000).toISOString());
    const adapter: Adapter = async () => ({ kind: "wait", afterMs: 10_000, message: "TikTok is still fetching the photos." });
    await runNextPublishJob({ sql: db.sql, r2: {} as never, setting: () => "", adapters: { facebook: adapter } });
    const sent = db.statements.flatMap((s) => s.params).filter((p): p is string => typeof p === "string");
    expect(sent).toContain("TikTok is still fetching the photos after 30 minutes. Check the platform before posting again.");
  });

  // A retry looks on the platform first only when the failed attempt may have reached it.
  const failedWith = async (adapter: Adapter) => {
    const db = fakeDatabase();
    await runNextPublishJob({ sql: db.sql, r2: {} as never, setting: () => "", adapters: { facebook: adapter } });
    const failed = db.statements.find((s) => s.text.includes("SET status = 'failed'"));
    return failed?.params[4];
  };

  it("marks a failure as maybe live when the publish call started and the result is unknown", async () => {
    expect(await failedWith(async (ctx) => {
      await ctx.save({ publish_started_at: new Date().toISOString() });
      throw new PublishError("unconfirmed", "The video upload was interrupted and it is not on the Page yet.");
    })).toBe(true);
  });

  it("does not mark a refused or never-sent post as maybe live", async () => {
    expect(await failedWith(async (ctx) => {
      await ctx.save({ publish_started_at: new Date().toISOString() });
      throw new PublishError("meta_100", "Facebook refused the post.");
    })).toBe(false);
    expect(await failedWith(async () => {
      throw new PublishError("unconfirmed", "Could not confirm.");
    })).toBe(false);
  });
});

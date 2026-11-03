import { describe, expect, it } from "vitest";
import type { Sql } from "../../../backend/lib/access";
import { answerComment, subscribeAccounts, type InboxDeps } from "./runner";

const account = { id: "acc", workspace_id: "w1", platform: "instagram", display_name: "Maker", external_account_id: "app-scoped", webhook_id: "1784" };
const automation = {
  id: "auto1", workspace_id: "w1", connected_account_id: "acc", platform_post_id: null, keywords: ["guide"], match_mode: "word", exclude_keywords: [],
  created_at: "2026-11-01T00:00:00Z", dm_message: "Hi {username}, here you go", dm_variations: [], dm_buttons: [{ label: "Get it", url: "https://example.com/g" }],
  comment_reply: "Sent you a DM", comment_reply_variations: [], repeat_mode: "once",
};

// A stand-in database for one account and one automation; records every write.
function fakeSql(opts: { alreadySent?: number; claimed?: boolean } = {}) {
  const writes: Array<{ query: string; params: unknown[] }> = [];
  const sql = (async (query: string, params: unknown[]) => {
    if (query.includes("FROM public.connected_accounts a LEFT JOIN public.inbox_accounts")) return [account];
    if (query.includes("FROM public.comment_automations WHERE connected_account_id")) return [automation];
    if (query.includes("count(*)::int AS n FROM public.automation_runs")) return [{ n: opts.alreadySent ?? 0 }];
    if (query.includes("INSERT INTO public.automation_runs")) {
      writes.push({ query, params });
      return opts.claimed === false ? [] : [{ id: "run1" }];
    }
    if (query.includes("FROM public.inbox_accounts ia JOIN")) return [{ ...account, webhook_id: null }];
    if (query.includes("INSERT INTO public.contacts")) return [{ id: "ct1" }];
    if (query.includes("INSERT INTO public.conversations")) return [{ id: "cv1" }];
    if (query.includes("INSERT INTO public.messages")) {
      writes.push({ query, params });
      return [{ id: "m1" }];
    }
    writes.push({ query, params });
    return [];
  }) as Sql;
  return { sql, writes };
}

function fakeGraph() {
  const calls: Array<{ url: string; body: unknown }> = [];
  const http = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), body: init.body ? JSON.parse(String(init.body)) : null });
    if (String(url).includes("me?fields=user_id")) return new Response(JSON.stringify({ user_id: "1784" }));
    return new Response(JSON.stringify({ success: true, message_id: "m1", id: "r1" }));
  }) as typeof fetch;
  return { http, calls };
}

const deps = (db: ReturnType<typeof fakeSql>, graph: ReturnType<typeof fakeGraph>): InboxDeps => ({
  sql: db.sql, http: graph.http, setting: () => "", token: async () => "tok", linkBase: "https://www.postsocial.xyz/", random: () => 0.5,
});

const comment = { id: "c1", text: "GUIDE please", from: { id: "fan", username: "jay" }, media: { id: "p1" } };

describe("comment-to-DM", () => {
  it("DMs the commenter a tracked link button, then replies publicly", async () => {
    const db = fakeSql();
    const graph = fakeGraph();
    expect(await answerComment(deps(db, graph), "1784", comment)).toBe("sent");
    const [dm, reply] = graph.calls;
    expect(dm.url).toBe("https://graph.instagram.com/v25.0/me/messages");
    const message = (dm.body as { recipient: unknown; message: { attachment: { payload: { text: string; buttons: Array<{ url: string; title: string }> } } } });
    expect(message.recipient).toEqual({ comment_id: "c1" });
    expect(message.message.attachment.payload.text).toBe("Hi @jay, here you go");
    expect(message.message.attachment.payload.buttons[0].title).toBe("Get it");
    expect(message.message.attachment.payload.buttons[0].url).toMatch(/^https:\/\/www\.postsocial\.xyz\/l\/[A-Za-z0-9]{10}$/);
    expect(reply.url).toBe("https://graph.instagram.com/v25.0/c1/replies");
    const link = db.writes.find((w) => w.query.includes("INSERT INTO public.tracked_links"))!;
    expect(link.params.slice(1)).toEqual(["w1", "auto1", "run1", "https://example.com/g"]);
    const done = db.writes.find((w) => w.query.includes("UPDATE public.automation_runs SET status"))!;
    expect(done.params.slice(1)).toEqual(["sent", null, "Hi @jay, here you go", "sent"]);
    // The DM also shows in the commenter's conversation, marked as sent by the automation.
    const logged = db.writes.find((w) => w.query.includes("INSERT INTO public.messages"))!;
    expect(logged.params.slice(2, 7)).toEqual(["out", null, "Hi @jay, here you go", "[]", "automation"]);
  });

  it("never answers the account's own comments", async () => {
    const graph = fakeGraph();
    expect(await answerComment(deps(fakeSql(), graph), "1784", { ...comment, from: { id: "1784" } })).toBe("own comment");
    expect(graph.calls).toHaveLength(0);
  });

  it("DMs each person once, and never twice for one comment", async () => {
    const graph = fakeGraph();
    expect(await answerComment(deps(fakeSql({ alreadySent: 1 }), graph), "1784", comment)).toBe("skipped");
    expect(await answerComment(deps(fakeSql({ claimed: false }), graph), "1784", comment)).toBe("already handled");
    expect(graph.calls).toHaveLength(0);
  });

  it("ignores comments without a keyword", async () => {
    const graph = fakeGraph();
    expect(await answerComment(deps(fakeSql(), graph), "1784", { ...comment, text: "love this" })).toBe("no match");
    expect(graph.calls).toHaveLength(0);
  });

  it("subscribes a new account to comment and message webhooks", async () => {
    const db = fakeSql();
    const graph = fakeGraph();
    expect(await subscribeAccounts(deps(db, graph))).toBe(1);
    expect(graph.calls.map((c) => c.url)).toEqual([
      "https://graph.instagram.com/v25.0/me?fields=user_id,username",
      "https://graph.instagram.com/v25.0/me/subscribed_apps?subscribed_fields=comments,messages",
    ]);
    const saved = db.writes.find((w) => w.query.includes("SET webhook_id"))!;
    expect(saved.params).toEqual(["acc", "1784", ["comments", "messages"]]);
  });
});

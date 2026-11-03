import { describe, expect, it } from "vitest";
import type { Sql } from "../../../backend/lib/access";
import { recordMessage, runOutbox } from "./inbox";
import type { InboxDeps } from "./runner";

const account = { id: "acc", workspace_id: "w1", platform: "instagram", display_name: "Maker", external_account_id: "app-scoped", webhook_id: "1784" };
const HOUR = 3600_000;

// A stand-in database: one account, one conversation; records writes.
function fakeSql(state: { lastInbound?: number | null; outbox?: unknown[]; comment?: Record<string, unknown> } = {}) {
  const writes: Array<{ query: string; params: unknown[] }> = [];
  const sql = (async (query: string, params: unknown[]) => {
    if (query.includes("FROM public.connected_accounts a LEFT JOIN public.inbox_accounts")) return [account];
    if (query.includes("INSERT INTO public.contacts")) return (writes.push({ query, params }), [{ id: "ct1" }]);
    if (query.includes("INSERT INTO public.conversations")) return [{ id: "cv1" }];
    if (query.includes("INSERT INTO public.messages")) return (writes.push({ query, params }), [{ id: "m1" }]);
    if (query.includes("claim_inbox_outbox")) return state.outbox ?? [];
    if (query.includes("FROM public.conversations cv JOIN public.contacts ct")) {
      return [{ platform_user_id: "fan", username: "jay", last_inbound_at: state.lastInbound === null ? null : new Date(state.lastInbound ?? Date.now() - HOUR).toISOString() }];
    }
    if (query.includes("FROM public.inbox_comments WHERE id")) return state.comment ? [state.comment] : [];
    writes.push({ query, params });
    return [];
  }) as Sql;
  return { sql, writes };
}

function fakeGraph() {
  const calls: Array<{ url: string; body: unknown }> = [];
  const http = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), body: init.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify({ message_id: "mid9", success: true }));
  }) as typeof fetch;
  return { http, calls };
}

const deps = (db: ReturnType<typeof fakeSql>, graph: ReturnType<typeof fakeGraph>): InboxDeps => ({ sql: db.sql, http: graph.http, setting: () => "", token: async () => "tok", linkBase: "https://x" });
const item = (r: Record<string, unknown>) => ({ id: "o1", workspace_id: "w1", connected_account_id: "acc", conversation_id: "cv1", comment_id: "cm1", text: "Thanks!", sent_by: "person", actor_id: "act", ...r });
const status = (db: ReturnType<typeof fakeSql>) => db.writes.find((w) => w.query.includes("UPDATE public.inbox_outbox SET status"))!;

describe("inbox: storing DMs", () => {
  it("keeps a person's DM as inbound, with its contact", async () => {
    const db = fakeSql();
    await recordMessage(deps(db, fakeGraph()), "1784", { sender: { id: "fan" }, recipient: { id: "1784" }, timestamp: 1_700_000_000_000, message: { mid: "m-1", text: "hey!" } });
    const msg = db.writes.find((w) => w.query.includes("INSERT INTO public.messages"))!;
    expect(msg.params.slice(2, 7)).toEqual(["in", "m-1", "hey!", "[]", "contact"]);
    const conv = db.writes.find((w) => w.query.includes("UPDATE public.conversations SET last_message_at"))!;
    expect(conv.params[3]).toBe("in");
  });

  it("keeps the account's own reply from Instagram's app as outgoing", async () => {
    const db = fakeSql();
    await recordMessage(deps(db, fakeGraph()), "1784", { sender: { id: "1784" }, recipient: { id: "fan" }, message: { mid: "m-2", text: "hi", is_echo: true } });
    const contact = db.writes.find((w) => w.query.includes("INSERT INTO public.contacts"))!;
    expect(contact.params[2]).toBe("fan");
    const msg = db.writes.find((w) => w.query.includes("INSERT INTO public.messages"))!;
    expect(msg.params.slice(2, 7)).toEqual(["out", "m-2", "hi", "[]", "instagram"]);
  });
});

describe("inbox: sending", () => {
  it("sends a DM reply inside the 24-hour window and logs it", async () => {
    const db = fakeSql({ outbox: [item({ kind: "message" })] });
    const graph = fakeGraph();
    expect(await runOutbox(deps(db, graph))).toBe(1);
    expect(graph.calls[0].url).toBe("https://graph.instagram.com/v25.0/me/messages");
    expect(graph.calls[0].body).toEqual({ recipient: { id: "fan" }, message: { text: "Thanks!" } });
    const msg = db.writes.find((w) => w.query.includes("INSERT INTO public.messages"))!;
    expect(msg.params.slice(2, 8)).toEqual(["out", "mid9", "Thanks!", "[]", "person", "act"]);
    expect(status(db).query).toContain("status = 'sent'");
  });

  it("refuses a DM reply after the window closes, with Instagram's rule", async () => {
    const db = fakeSql({ outbox: [item({ kind: "message" })], lastInbound: Date.now() - 25 * HOUR });
    const graph = fakeGraph();
    expect(await runOutbox(deps(db, graph))).toBe(0);
    expect(graph.calls).toHaveLength(0);
    expect(status(db).params[1]).toMatch(/24 hours/);
  });

  it("DMs a commenter once, by comment, within 7 days", async () => {
    const fresh = { platform_comment_id: "c9", commenter_id: "fan", commenter_username: "jay", created_at: new Date().toISOString(), dm_sent_at: null };
    const db = fakeSql({ outbox: [item({ kind: "private_reply" })], comment: fresh });
    const graph = fakeGraph();
    expect(await runOutbox(deps(db, graph))).toBe(1);
    expect(graph.calls[0].body).toEqual({ recipient: { comment_id: "c9" }, message: { text: "Thanks!" } });

    const again = fakeSql({ outbox: [item({ kind: "private_reply" })], comment: { ...fresh, dm_sent_at: new Date().toISOString() } });
    expect(await runOutbox(deps(again, fakeGraph()))).toBe(0);
    expect(status(again).params[1]).toMatch(/already got a DM/);
  });

  it("hides a comment", async () => {
    const db = fakeSql({ outbox: [item({ kind: "hide_comment", text: null })], comment: { platform_comment_id: "c9", commenter_id: null, commenter_username: null, created_at: new Date().toISOString(), dm_sent_at: null } });
    const graph = fakeGraph();
    expect(await runOutbox(deps(db, graph))).toBe(1);
    expect(graph.calls[0].url).toBe("https://graph.instagram.com/v25.0/c9?hide=true");
    expect(db.writes.find((w) => w.query.includes("SET hidden"))!.params).toEqual(["cm1", true]);
  });
});

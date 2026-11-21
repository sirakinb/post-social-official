import { describe, expect, it } from "vitest";
import type { Sql } from "../../../backend/lib/access";
import { catchUpLinkedInComments, commentIdOf, purgeLinkedInComments, sendLinkedIn } from "./linkedin";
import type { InboxDeps } from "./runner";

const NOW = Date.parse("2026-11-16T12:00:00Z");
const PAGE = { id: "acc-1", workspace_id: "w1", platform: "linkedin", display_name: "Pentridge Media", external_account_id: "organization:101" };
const POST = "urn:li:share:9";
const COMMENT = "urn:li:comment:(urn:li:activity:5,77)";

function deps(routes: Array<(url: URL, init: RequestInit) => Response | undefined>, rows: { comment?: Record<string, unknown> } = {}) {
  const writes: Array<{ query: string; params: unknown[] }> = [];
  const calls: Array<{ method: string; url: URL; body: unknown; headers: Headers }> = [];
  const sql = (async (query: string, params: unknown[] = []) => {
    if (query.includes("FROM public.connected_accounts a") && query.includes("organization:%")) return [PAGE];
    if (query.includes("FROM public.destinations")) return [{ platform_request_id: POST }];
    if (query.includes("SELECT platform_comment_id, platform_post_id, workspace_id")) return rows.comment ? [rows.comment] : [];
    writes.push({ query, params });
    return [];
  }) as unknown as Sql;
  const http = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ method: init.method ?? "GET", url, body: init.body ? JSON.parse(String(init.body)) : undefined, headers: new Headers(init.headers) });
    for (const route of routes) {
      const hit = route(url, init);
      if (hit) return hit;
    }
    return new Response(JSON.stringify({ message: "unexpected" }), { status: 500 });
  }) as typeof fetch;
  const d: InboxDeps = { sql, setting: (name) => (name === "INBOX_WORKSPACES" ? "w1" : ""), linkBase: "https://x", http, token: async () => "tok" };
  return { d, writes, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });

describe("LinkedIn Page comments", () => {
  it("reads the last 48 hours of comments on the Page's posts, without the commenter's profile", async () => {
    const { d, writes, calls } = deps([
      (u) => (decodeURIComponent(u.pathname) === `/rest/socialActions/${POST}/comments` ? json({ elements: [
        { commentUrn: COMMENT, actor: "urn:li:person:abc", created: { time: NOW - 3600_000 }, message: { text: "Love this" } },
        { commentUrn: "urn:li:comment:(urn:li:activity:5,78)", actor: "urn:li:organization:101", created: { time: NOW - 60_000 }, message: { text: "Thanks!" }, parentComment: COMMENT },
        { commentUrn: "urn:li:comment:(urn:li:activity:5,1)", actor: "urn:li:person:old", created: { time: NOW - 49 * 3600_000 }, message: { text: "Too old to keep" } },
      ] }) : undefined),
    ]);
    expect(await catchUpLinkedInComments(d, () => NOW)).toBe(2);
    expect(calls[0].url.searchParams.get("count")).toBe("50");
    const inserted = writes.filter((w) => w.query.includes("INSERT INTO public.inbox_comments"));
    expect(inserted.map((w) => [w.params[2], w.params[5], w.params[6], w.params[7]])).toEqual([
      [COMMENT, "urn:li:person:abc", "Love this", false],
      ["urn:li:comment:(urn:li:activity:5,78)", "urn:li:organization:101", "Thanks!", true],
    ]);
    // No name or picture is stored: commenter_username is always NULL.
    expect(inserted[0].query).toContain("$6, NULL, $7");
    expect(inserted[1].params[4]).toBe(COMMENT);
  });

  it("reads nothing where the inbox is off", async () => {
    const { d, calls } = deps([]);
    d.setting = () => "";
    expect(await catchUpLinkedInComments(d, () => NOW)).toBe(0);
    expect(calls).toEqual([]);
  });

  it("removes LinkedIn comments once they are 48 hours old", async () => {
    let asked = "";
    const sql = (async (query: string) => {
      asked = query;
      return [{ id: "c1" }];
    }) as unknown as Sql;
    expect(await purgeLinkedInComments(sql)).toBe(1);
    expect(asked).toContain("a.platform = 'linkedin'");
    expect(asked).toContain("interval '48 hours'");
  });

  it("replies as the Page under the comment", async () => {
    const { d, writes, calls } = deps(
      [(u, i) => (i.method === "POST" ? json({ commentUrn: "urn:li:comment:(urn:li:activity:5,90)" }, 201, { "x-restli-id": "90" }) : undefined)],
      { comment: { platform_comment_id: COMMENT, platform_post_id: POST, workspace_id: "w1" } },
    );
    await sendLinkedIn(d, PAGE, { kind: "comment_reply", comment_id: "c1", text: "Thank you!" });
    expect(decodeURIComponent(calls[0].url.pathname)).toBe(`/rest/socialActions/${COMMENT}/comments`);
    expect(calls[0].body).toEqual({ actor: "urn:li:organization:101", object: POST, parentComment: COMMENT, message: { text: "Thank you!" } });
    // LinkedIn refuses a comment's id in the address under the Rest.li 2.0 header.
    expect(calls[0].headers.get("x-restli-protocol-version")).toBeNull();
    expect(writes.some((w) => w.query.includes("from_account") && w.params[2] === "urn:li:comment:(urn:li:activity:5,90)")).toBe(true);
    expect(writes.some((w) => w.query.includes("SET replied_at = now()"))).toBe(true);
  });

  it("deletes as the Page, and treats a comment already gone as deleted", async () => {
    const { d, writes, calls } = deps(
      [(u, i) => (i.method === "DELETE" ? json({ message: "Not found" }, 404) : undefined)],
      { comment: { platform_comment_id: COMMENT, platform_post_id: POST, workspace_id: "w1" } },
    );
    await sendLinkedIn(d, PAGE, { kind: "delete_comment", comment_id: "c1", text: null });
    expect(decodeURIComponent(calls[0].url.pathname)).toBe(`/rest/socialActions/${POST}/comments/77`);
    expect(calls[0].url.searchParams.get("actor")).toBe("urn:li:organization:101");
    expect(writes.some((w) => w.query.includes("SET deleted_at = now()"))).toBe(true);
  });

  it("refuses what LinkedIn doesn't allow", async () => {
    const { d } = deps([], { comment: { platform_comment_id: COMMENT, platform_post_id: POST, workspace_id: "w1" } });
    await expect(sendLinkedIn(d, PAGE, { kind: "private_reply", comment_id: "c1", text: "hi" })).rejects.toThrow("DMs");
    await expect(sendLinkedIn(d, PAGE, { kind: "hide_comment", comment_id: "c1", text: null })).rejects.toThrow("hide");
    await expect(sendLinkedIn(d, { ...PAGE, external_account_id: "m1" }, { kind: "comment_reply", comment_id: "c1", text: "hi" })).rejects.toThrow("Company Pages");
  });

  it("finds a comment's id in its URN", () => {
    expect(commentIdOf(COMMENT)).toBe("77");
    expect(commentIdOf("nonsense")).toBeNull();
  });
});

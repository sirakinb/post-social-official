import { describe, expect, it } from "vitest";
import type { Sql } from "./access";
import { NUDGE_COPY_TO, NUDGE_FROM, composeEmail, findDue, linkToken, resendSender, runNudgeSweep, unsubscribeUrl, validLinkToken, type Due } from "./nudges";

const USER = "11111111-1111-4111-8111-111111111111";
const due = (kind: Due["kind"], extra: Partial<Due> = {}): Due => ({ user_id: USER, email: "nia@example.com", name: "Nia Test", workspace_id: "w1", kind, ...extra });

describe("unsubscribe links", () => {
  it("are signed per person and checked", async () => {
    const t = await linkToken("secret", USER);
    expect(await validLinkToken("secret", USER, t)).toBe(true);
    expect(await validLinkToken("other", USER, t)).toBe(false);
    expect(await validLinkToken("secret", "22222222-2222-4222-8222-222222222222", t)).toBe(false);
    expect(await validLinkToken("secret", USER, "nope")).toBe(false);
  });

  it("point at the website's unsubscribe page", async () => {
    const url = new URL(await unsubscribeUrl("https://www.postsocial.xyz", "secret", USER));
    expect(url.origin + url.pathname).toBe("https://www.postsocial.xyz/email/unsubscribe");
    expect(url.searchParams.get("u")).toBe(USER);
    expect(url.searchParams.get("t")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("composeEmail", () => {
  const app = "https://www.postsocial.xyz";
  it("writes each email plainly, by first name, signed by Aki, with the unsubscribe link", () => {
    for (const kind of ["no_account", "no_ai", "first_post_live"] as const) {
      const email = composeEmail(due(kind, { platform: "instagram", live_url: "https://instagram.com/p/x" }), app, "https://www.postsocial.xyz/email/unsubscribe?u=1&t=2");
      expect(email.to).toBe("nia@example.com");
      expect(email.text.startsWith("Hi Nia,")).toBe(true);
      expect(email.text).toContain("Aki\nFounder, Post Social");
      expect(email.text).toContain("Unsubscribe: https://www.postsocial.xyz/email/unsubscribe?u=1&t=2");
      expect(email.html).toContain('href="https://www.postsocial.xyz/email/unsubscribe?u=1&amp;t=2"');
      expect(email.text).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    }
  });

  it("links the right next step", () => {
    expect(composeEmail(due("no_account"), app, "u").text).toContain(`${app}/beta/accounts`);
    expect(composeEmail(due("no_ai"), app, "u").text).toContain(`${app}/beta/api`);
    const live = composeEmail(due("first_post_live", { platform: "tiktok", live_url: "https://tiktok.com/@a/video/1" }), app, "u");
    expect(live.subject).toBe("Your first post is live");
    expect(live.text).toContain("went live on TikTok: https://tiktok.com/@a/video/1");
  });

  it("says hello without a name, and escapes names in the HTML", () => {
    expect(composeEmail(due("no_account", { name: null }), app, "u").text.startsWith("Hi there,")).toBe(true);
    expect(composeEmail(due("no_account", { name: "<b>Eve</b>" }), app, "u").html).not.toContain("<b>Eve");
  });
});

describe("findDue", () => {
  it("only picks owners who created the workspace, with a confirmed email, not yet sent, not unsubscribed", async () => {
    const queries: string[] = [];
    const sql = (async (query: string) => { queries.push(query); return []; }) as Sql;
    await findDue(sql);
    expect(queries).toHaveLength(3);
    for (const q of queries) {
      expect(q).toContain("m.role = 'owner' AND m.user_id = w.created_by");
      expect(q).toContain("u.email_verified");
      expect(q).toContain("public.email_nudges");
      expect(q).toContain("nudges_off_at IS NOT NULL");
    }
    expect(queries[0]).toContain("interval '24 hours'");
    expect(queries[1]).toContain("interval '72 hours'");
    expect(queries[2]).toContain("d.status = 'published'");
  });
});

describe("runNudgeSweep", () => {
  function fakeSql(rows: Due[], claimable: boolean) {
    const log: string[] = [];
    const sql = (async (query: string) => {
      if (query.includes("SELECT m.user_id")) { const r = query.includes("'no_account' AS kind") ? rows : []; return r; }
      if (query.startsWith("INSERT INTO public.email_nudges")) { log.push("claim"); return claimable ? [{ user_id: USER }] : []; }
      if (query.startsWith("DELETE FROM public.email_nudges")) { log.push("release"); return []; }
      return [];
    }) as Sql;
    return { sql, log };
  }

  it("claims, then sends", async () => {
    const { sql, log } = fakeSql([due("no_account")], true);
    const sent: string[] = [];
    expect(await runNudgeSweep({ sql, appUrl: "https://www.postsocial.xyz", secret: "s", send: async (e) => { sent.push(e.subject); return true; } })).toBe(1);
    expect(log).toEqual(["claim"]);
    expect(sent).toEqual(["Connect your first account to Post Social"]);
  });

  it("never sends what another sweep already claimed", async () => {
    const { sql } = fakeSql([due("no_account")], false);
    let sends = 0;
    expect(await runNudgeSweep({ sql, appUrl: "https://x", secret: "s", send: async () => { sends++; return true; } })).toBe(0);
    expect(sends).toBe(0);
  });

  it("gives the claim back when sending fails, so the next sweep tries again", async () => {
    const { sql, log } = fakeSql([due("no_account")], true);
    expect(await runNudgeSweep({ sql, appUrl: "https://x", secret: "s", send: async () => false })).toBe(0);
    expect(log).toEqual(["claim", "release"]);
  });
});

describe("resendSender", () => {
  it("sends from Aki, copies him blind, and adds the unsubscribe header", async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl = (async (_url: string, init: RequestInit) => { body = JSON.parse(String(init.body)); return new Response("{}", { status: 200 }); }) as typeof fetch;
    const ok = await resendSender("key", fetchImpl)(composeEmail(due("no_ai"), "https://www.postsocial.xyz", "https://www.postsocial.xyz/email/unsubscribe?u=1&t=2"));
    expect(ok).toBe(true);
    expect(body.from).toBe(NUDGE_FROM);
    expect(body.to).toEqual(["nia@example.com"]);
    expect(body.bcc).toEqual([NUDGE_COPY_TO]);
    expect((body.headers as Record<string, string>)["List-Unsubscribe"]).toBe("<https://www.postsocial.xyz/email/unsubscribe?u=1&t=2>");
  });
});

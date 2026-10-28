import { describe, expect, it } from "vitest";
import type { Sql } from "./access";
import { CALL_URL, NUDGE_COPY_TO, NUDGE_FROM, NUDGE_REPLY_TO, composeEmail, findDue, linkToken, resendSender, runNudgeSweep, unsubscribeUrl, validLinkToken, type Due } from "./nudges";

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
      expect(email.text).toContain("Aki\nPost Social");
      expect(email.html).toContain("Post Social</td>");
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
    expect(live.text).toContain("went live on TikTok.");
    expect(live.text).toContain("See your post: https://tiktok.com/@a/video/1");
    expect(live.html).toContain('href="https://tiktok.com/@a/video/1"');
    // Anything that isn't a plain https link is never put in a button.
    expect(composeEmail(due("first_post_live", { live_url: "javascript:alert(1)" }), app, "u").html).not.toContain("javascript:");
  });

  it("writes the welcome and the week-one email as a plain note from Aki, with the unsubscribe link", () => {
    for (const kind of ["welcome", "week_one"] as const) {
      const email = composeEmail(due(kind), app, "https://www.postsocial.xyz/email/unsubscribe?u=1&t=2");
      expect(email.text.startsWith("Hi Nia,")).toBe(true);
      expect(email.text).toContain("\n\nAki\n\n--");
      expect(email.text).toContain("Unsubscribe: https://www.postsocial.xyz/email/unsubscribe?u=1&t=2");
      expect(email.html).toContain('href="https://www.postsocial.xyz/email/unsubscribe?u=1&amp;t=2"');
      // No designed card: no logo, no button.
      expect(email.html).not.toContain("post-social-icon.png");
      expect(email.html).not.toContain("border-radius:999px");
      expect(email.text).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    }
  });

  it("welcomes with the step they haven't done yet", () => {
    const fresh = composeEmail(due("welcome"), app, "u");
    expect(fresh.subject).toBe("Welcome to Post Social");
    expect(fresh.text).toContain(`${app}/beta/accounts`);
    expect(fresh.text).toContain("Just reply and tell me.");
    const connected = composeEmail(due("welcome", { connected: true }), app, "u");
    expect(connected.text).toContain(`${app}/beta/api`);
    expect(connected.text).not.toContain(`${app}/beta/accounts`);
  });

  it("asks for a call a week in, with Aki's booking link", () => {
    const email = composeEmail(due("week_one"), app, "u");
    expect(email.subject).toBe("One week with Post Social");
    expect(email.text).toContain(`Book a time that works for you here: ${CALL_URL}`);
    expect(email.html).toContain(`href="${CALL_URL}"`);
  });

  it("says hello without a name, and escapes names in the HTML", () => {
    expect(composeEmail(due("no_account", { name: null }), app, "u").text.startsWith("Hi there,")).toBe(true);
    expect(composeEmail(due("no_account", { name: "<b>Eve</b>" }), app, "u").html).not.toContain("<b>Eve");
  });

  it("loads the logo from the public site even when links point elsewhere (dev links go to staging)", () => {
    const email = composeEmail(due("no_account"), "https://post-social-git-staging-app-build-26.vercel.app", "u");
    expect(email.html).toContain('src="https://www.postsocial.xyz/email/post-social-icon.png"');
    expect(email.text).toContain("https://post-social-git-staging-app-build-26.vercel.app/beta/accounts");
  });
});

describe("findDue", () => {
  it("only picks owners who created the workspace, with a confirmed email, not yet sent, not unsubscribed", async () => {
    const queries: string[] = [];
    const sql = (async (query: string) => { queries.push(query); return []; }) as Sql;
    await findDue(sql);
    expect(queries).toHaveLength(5);
    for (const q of queries) {
      expect(q).toContain("m.role = 'owner' AND m.user_id = w.created_by");
      expect(q).toContain("u.email_verified");
      expect(q).toContain("public.email_nudges");
      expect(q).toContain("nudges_off_at IS NOT NULL");
    }
    expect(queries[0]).toContain("'welcome' AS kind");
    expect(queries[0]).toContain("w.created_at > now() - interval '48 hours'");
    expect(queries[1]).toContain("w.created_at < now() - interval '48 hours'");
    expect(queries[2]).toContain("interval '72 hours'");
    expect(queries[3]).toContain("d.status = 'published'");
    expect(queries[4]).toContain("'week_one' AS kind");
    expect(queries[4]).toContain("w.created_at < now() - interval '7 days'");
    // Sent to everyone a week in, whatever they've done: no account, AI or post conditions.
    expect(queries[4]).not.toContain("connected_accounts");
    expect(queries[4]).not.toContain("destinations");
  });
});

describe("runNudgeSweep", () => {
  function fakeSql(rows: Due[], claimable: boolean) {
    const log: string[] = [];
    const sql = (async (query: string) => {
      if (query.includes("SELECT m.user_id")) { const r = query.includes("'no_account' AS kind") ? rows : []; return r; }
      if (query.startsWith("INSERT INTO public.email_nudges")) { log.push("claim"); return claimable ? [{ user_id: USER }] : []; }
      if (query.startsWith("DELETE FROM public.email_nudges")) { log.push("release"); return []; }
      if (query.startsWith("UPDATE public.email_nudges SET resend_id")) { log.push("record id"); return []; }
      return [];
    }) as Sql;
    return { sql, log };
  }

  it("claims, then sends", async () => {
    const { sql, log } = fakeSql([due("no_account")], true);
    const sent: string[] = [];
    expect(await runNudgeSweep({ sql, appUrl: "https://www.postsocial.xyz", secret: "s", send: async (e) => { sent.push(e.subject); return "re_1"; } })).toBe(1);
    expect(log).toEqual(["claim", "record id"]);
    expect(sent).toEqual(["Connect your first account to Post Social"]);
  });

  it("never sends what another sweep already claimed", async () => {
    const { sql } = fakeSql([due("no_account")], false);
    let sends = 0;
    expect(await runNudgeSweep({ sql, appUrl: "https://x", secret: "s", send: async () => { sends++; return "re_1"; } })).toBe(0);
    expect(sends).toBe(0);
  });

  it("holds the week-one email when the same sweep already emailed them", async () => {
    const log: string[] = [];
    const sql = (async (query: string) => {
      if (query.includes("'no_account' AS kind")) return [due("no_account")];
      if (query.includes("'week_one' AS kind")) return [due("week_one")];
      if (query.startsWith("INSERT INTO public.email_nudges")) { log.push("claim"); return [{ user_id: USER }]; }
      return [];
    }) as Sql;
    const sent: string[] = [];
    expect(await runNudgeSweep({ sql, appUrl: "https://x", secret: "s", send: async (e) => { sent.push(e.subject); return "re_1"; } })).toBe(1);
    expect(sent).toEqual(["Connect your first account to Post Social"]);
    expect(log).toEqual(["claim"]);
  });

  it("skips an email the database won't record and still sends the rest", async () => {
    const sql = (async (query: string, params?: unknown[]) => {
      if (query.includes("'welcome' AS kind")) return [due("welcome")];
      if (query.includes("'no_account' AS kind")) return [due("no_account", { user_id: "22222222-2222-4222-8222-222222222222" })];
      if (query.startsWith("INSERT INTO public.email_nudges")) {
        if (params?.[1] === "welcome") throw new Error("violates check constraint");
        return [{ user_id: params?.[0] }];
      }
      return [];
    }) as Sql;
    const sent: string[] = [];
    expect(await runNudgeSweep({ sql, appUrl: "https://x", secret: "s", send: async (e) => { sent.push(e.subject); return "re_1"; } })).toBe(1);
    expect(sent).toEqual(["Connect your first account to Post Social"]);
  });

  it("gives the claim back when sending fails, so the next sweep tries again", async () => {
    const { sql, log } = fakeSql([due("no_account")], true);
    expect(await runNudgeSweep({ sql, appUrl: "https://x", secret: "s", send: async () => null })).toBe(0);
    expect(log).toEqual(["claim", "release"]);
  });

  it("counts a send Resend took without an id, and records nothing", async () => {
    const { sql, log } = fakeSql([due("no_account")], true);
    expect(await runNudgeSweep({ sql, appUrl: "https://x", secret: "s", send: async () => "" })).toBe(1);
    expect(log).toEqual(["claim"]);
  });
});

describe("resendSender", () => {
  it("sends from Aki, copies him blind, and adds the unsubscribe header", async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl = (async (_url: string, init: RequestInit) => { body = JSON.parse(String(init.body)); return new Response('{"id":"re_123"}', { status: 200 }); }) as typeof fetch;
    const id = await resendSender("key", fetchImpl)(composeEmail(due("no_ai"), "https://www.postsocial.xyz", "https://www.postsocial.xyz/email/unsubscribe?u=1&t=2"));
    expect(id).toBe("re_123");
    expect(body.from).toBe(NUDGE_FROM);
    expect(NUDGE_FROM).toBe("Aki <aki@postsocial.xyz>");
    expect(body.reply_to).toBe(NUDGE_REPLY_TO);
    expect(body.to).toEqual(["nia@example.com"]);
    expect(body.bcc).toEqual([NUDGE_COPY_TO]);
    expect((body.headers as Record<string, string>)["List-Unsubscribe"]).toBe("<https://www.postsocial.xyz/email/unsubscribe?u=1&t=2>");
    expect(body.tags).toEqual([
      { name: "type", value: "nudge" },
      { name: "kind", value: "no_ai" },
      { name: "user_id", value: due("no_ai").user_id },
    ]);
  });

  it("gives back null when Resend refuses the email", async () => {
    const fetchImpl = (async () => new Response('{"message":"no"}', { status: 422 })) as typeof fetch;
    expect(await resendSender("key", fetchImpl)(composeEmail(due("no_ai"), "https://x", "https://x/u"))).toBeNull();
  });
});

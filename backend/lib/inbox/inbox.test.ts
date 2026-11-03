import { describe, expect, it } from "vitest";
import { ApiError } from "../access";
import { cleanButtons, inboxOn, inboxSwitch } from "./automations";
import { automationMatches, keywordMatches, personalize, pickAutomation, pickVariation, type AutomationRule } from "./match";
import { eventsIn, signatureValid, verifyWebhook } from "./webhooks";

const rule = (r: Partial<AutomationRule>): AutomationRule => ({ id: "a", platform_post_id: null, keywords: [], match_mode: "word", exclude_keywords: [], created_at: "2026-11-01T00:00:00Z", ...r });

describe("keyword matching", () => {
  it("whole word ignores case and punctuation but not longer words", () => {
    expect(keywordMatches("Send me the GUIDE!", "guide", "word")).toBe(true);
    expect(keywordMatches("guide 🙏", "Guide", "word")).toBe(true);
    expect(keywordMatches("guidebook please", "guide", "word")).toBe(false);
    expect(keywordMatches("free guide now", "free guide", "word")).toBe(true);
  });

  it("contains matches inside words; exact needs the whole comment", () => {
    expect(keywordMatches("guidebook", "guide", "contains")).toBe(true);
    expect(keywordMatches("Guide!", "guide", "exact")).toBe(true);
    expect(keywordMatches("the guide", "guide", "exact")).toBe(false);
  });

  it("excluded words win, and no keywords means any comment", () => {
    expect(automationMatches(rule({ keywords: ["guide"], exclude_keywords: ["stop"] }), { text: "guide stop", postId: "p" })).toBe(false);
    expect(automationMatches(rule({}), { text: "love this", postId: "p" })).toBe(true);
    expect(automationMatches(rule({ platform_post_id: "p2" }), { text: "love this", postId: "p" })).toBe(false);
  });

  it("a post's own automation wins over an every-post one, then the newest", () => {
    const all = rule({ id: "all", keywords: ["guide"], created_at: "2026-11-02T00:00:00Z" });
    const post = rule({ id: "post", platform_post_id: "p", keywords: ["guide"] });
    expect(pickAutomation([all, post], { text: "guide", postId: "p" })?.id).toBe("post");
    expect(pickAutomation([all, post], { text: "guide", postId: "other" })?.id).toBe("all");
    expect(pickAutomation([all], { text: "nope", postId: "p" })).toBeNull();
  });

  it("variations and {username}", () => {
    expect(pickVariation("a", ["b", " "], () => 0.99)).toBe("b");
    expect(personalize("Hi {username}!", "jay")).toBe("Hi @jay!");
    expect(personalize("Hi {username}!", null)).toBe("Hi there!");
  });
});

describe("automation settings", () => {
  it("is switched on per workspace or for all", () => {
    const on = inboxSwitch((name) => (name === "INBOX_WORKSPACES" ? "AB-1, cd-2" : undefined));
    expect(inboxOn(on, "ab-1")).toBe(true);
    expect(inboxOn(on, "zz")).toBe(false);
    expect(inboxOn(inboxSwitch(() => "all"), "zz")).toBe(true);
    expect(inboxOn(inboxSwitch(() => { throw new Error("unset"); }), "ab-1")).toBe(false);
  });

  it("buttons need a label and a web address, up to 3", () => {
    expect(cleanButtons([{ label: " Get it ", url: "example.com/guide" }])).toEqual([{ label: "Get it", url: "https://example.com/guide" }]);
    expect(() => cleanButtons([{ label: "x", url: "javascript:alert(1)" }])).toThrow(ApiError);
    expect(() => cleanButtons([{ label: "", url: "https://a.co" }])).toThrow(/label/);
    expect(() => cleanButtons(Array(4).fill({ label: "a", url: "https://a.co" }))).toThrow(/up to 3/);
  });
});

describe("Meta webhooks", () => {
  it("answers the address check only with our token", () => {
    const params = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "t", "hub.challenge": "123" });
    expect(verifyWebhook(params, "t")).toBe("123");
    expect(verifyWebhook(params, "other")).toBeNull();
    expect(verifyWebhook(params, null)).toBeNull();
  });

  it("accepts a delivery signed with any of our app secrets, nothing else", async () => {
    const body = '{"object":"instagram"}';
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("s2"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))].map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(await signatureValid(body, `sha256=${sig}`, ["s1", "s2"])).toBe(true);
    expect(await signatureValid(`${body} `, `sha256=${sig}`, ["s1", "s2"])).toBe(false);
    expect(await signatureValid(body, null, ["s2"])).toBe(false);
  });

  it("stores one event per comment change and per message", () => {
    const events = eventsIn({
      object: "instagram",
      entry: [{ id: "178", changes: [{ field: "comments", value: { id: "c1", text: "guide" } }], messaging: [{ message: { text: "hi" } }] }],
    });
    expect(events.map((e) => [e.entryId, e.field])).toEqual([["178", "comments"], ["178", "messages"]]);
    expect(eventsIn({ object: "user", entry: [] })).toEqual([]);
  });
});

// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Sql } from "../access";
import { forwardSettings, onlyAccounts, receiveWebhook, signatureValid } from "./webhooks";

const SECRET = "app-secret";
const sign = async (body: string, secret = SECRET) => {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `sha256=${[...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
};

// One Instagram delivery batching our test account (ig-test) with a real user's (ig-real).
const MIXED = {
  object: "instagram",
  entry: [
    { id: "ig-test", time: 1, changes: [{ field: "comments", value: { id: "c1", text: "LINK" } }] },
    { id: "ig-real", time: 1, changes: [{ field: "comments", value: { id: "c2", text: "private" } }] },
  ],
};

function deps(forward: { url: string; ids: string[] } | null) {
  const stored: unknown[] = [];
  const sent: Array<{ url: string; body: string; signature: string | null }> = [];
  const sql = (async (_q: string, params: unknown[] = []) => { stored.push(...JSON.parse(String(params[0]))); return []; }) as unknown as Sql;
  const http = (async (url: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ url: String(url), body: String(init?.body), signature: new Headers(init?.headers).get("x-hub-signature-256") });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  return { stored, sent, deps: { sql, appSecrets: ["other", SECRET], forward, http } };
}

const post = async (body: unknown) => {
  const raw = JSON.stringify(body);
  return new Request("https://fn/connections/meta/webhooks", { method: "POST", body: raw, headers: { "x-hub-signature-256": await sign(raw) } });
};

describe("passing our test accounts' webhooks on to dev", () => {
  it("reads its settings only when both are set and the address is https", () => {
    const read = (values: Record<string, string>) => (name: string) => values[name];
    expect(forwardSettings(read({ META_WEBHOOK_FORWARD_URL: "https://dev/meta/webhooks", META_WEBHOOK_FORWARD_IDS: " a, b ,," }))).toEqual({ url: "https://dev/meta/webhooks", ids: ["a", "b"] });
    expect(forwardSettings(read({ META_WEBHOOK_FORWARD_URL: "https://dev/meta/webhooks" }))).toBeNull();
    expect(forwardSettings(read({ META_WEBHOOK_FORWARD_URL: "http://dev", META_WEBHOOK_FORWARD_IDS: "a" }))).toBeNull();
    expect(forwardSettings(read({}))).toBeNull();
  });

  it("keeps only the listed accounts from a batched delivery", () => {
    expect(onlyAccounts(MIXED, ["ig-test"])).toEqual({ object: "instagram", entry: [MIXED.entry[0]] });
    expect(onlyAccounts(MIXED, ["nobody"])).toBeNull();
    // Threads names the account by the replied-to post's owner.
    const threads = [
      { target_id: "post-1", values: [{ field: "replies", value: { id: "r1", root_post: { owner_id: "th-test" } } }] },
      { target_id: "post-2", values: [{ field: "replies", value: { id: "r2", root_post: { owner_id: "th-real" } } }] },
    ];
    expect(onlyAccounts(threads, ["th-test"])).toEqual([threads[0]]);
    expect(onlyAccounts(threads[1], ["th-test"])).toBeNull();
  });

  it("stores everything on prod but sends dev only the test account's part, signed again", async () => {
    const { stored, sent, deps: d } = deps({ url: "https://dev/meta/webhooks", ids: ["ig-test"] });
    const result = await receiveWebhook(d, await post(MIXED));
    expect(result).toEqual({ status: 200, stored: 2, forwarded: true });
    expect(stored).toHaveLength(2);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("https://dev/meta/webhooks");
    expect(sent[0].body).not.toContain("ig-real");
    expect(sent[0].body).not.toContain("private");
    expect(JSON.parse(sent[0].body)).toEqual({ object: "instagram", entry: [MIXED.entry[0]] });
    // Dev checks the signature with the same app secret.
    expect(await signatureValid(sent[0].body, sent[0].signature, [SECRET])).toBe(true);
  });

  it("sends nothing when no listed account is in the delivery, or forwarding is off", async () => {
    const real = { object: "instagram", entry: [MIXED.entry[1]] };
    const on = deps({ url: "https://dev/meta/webhooks", ids: ["ig-test"] });
    expect((await receiveWebhook(on.deps, await post(real))).forwarded).toBe(false);
    expect(on.sent).toHaveLength(0);
    const off = deps(null);
    expect((await receiveWebhook(off.deps, await post(MIXED))).forwarded).toBe(false);
    expect(off.sent).toHaveLength(0);
  });

  it("still answers Meta when dev is down, and never forwards an unsigned delivery", async () => {
    const down = deps({ url: "https://dev/meta/webhooks", ids: ["ig-test"] });
    down.deps.http = (async () => { throw new Error("unreachable"); }) as typeof fetch;
    expect(await receiveWebhook(down.deps, await post(MIXED))).toEqual({ status: 200, stored: 2, forwarded: false });
    const forged = deps({ url: "https://dev/meta/webhooks", ids: ["ig-test"] });
    const raw = JSON.stringify(MIXED);
    const bad = new Request("https://fn", { method: "POST", body: raw, headers: { "x-hub-signature-256": await sign(raw, "wrong") } });
    expect((await receiveWebhook(forged.deps, bad)).status).toBe(401);
    expect(forged.sent).toHaveLength(0);
    expect(forged.stored).toHaveLength(0);
  });
});

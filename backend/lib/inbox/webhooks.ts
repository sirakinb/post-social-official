// Meta's webhooks for Instagram and Facebook Page comments and messages, and Threads replies (connections function,
// /meta/webhooks). Meta first checks the address with a GET carrying our verify token, then
// POSTs events signed with the app secret. Events are stored as they arrive and handled by
// the worker, so Meta gets its answer straight away.
import type { Sql } from "../access";

// GET: Meta's address check. Answers the challenge only when the token is ours.
export function verifyWebhook(params: URLSearchParams, verifyToken: string | null) {
  if (!verifyToken) return null;
  if (params.get("hub.mode") !== "subscribe" || params.get("hub.verify_token") !== verifyToken) return null;
  return params.get("hub.challenge");
}

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function hmacHex(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
}

// X-Hub-Signature-256 is "sha256=" + the HMAC of the raw body with the app's secret. Any of
// our Meta apps' secrets may have signed it; returns the one that did.
async function signingSecret(rawBody: string, header: string | null, secrets: string[]) {
  const sent = header?.startsWith("sha256=") ? header.slice(7).toLowerCase() : null;
  if (!sent || !/^[0-9a-f]{64}$/.test(sent)) return null;
  for (const secret of secrets) {
    const expected = await hmacHex(secret, rawBody);
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sent.charCodeAt(i);
    if (diff === 0) return secret;
  }
  return null;
}

export async function signatureValid(rawBody: string, header: string | null, secrets: string[]) {
  return (await signingSecret(rawBody, header, secrets)) !== null;
}

export type StoredEvent = { platform: "instagram" | "facebook" | "threads"; entryId: string; field: string; payload: unknown };

// Threads sends its own shape: { target_id (the account), values: { field, value } }, one per
// delivery or several in a list.
function threadsEvents(body: unknown): StoredEvent[] {
  const deliveries = (Array.isArray(body) ? body : [body]) as Array<{ target_id?: unknown; values?: unknown }>;
  const events: StoredEvent[] = [];
  for (const d of deliveries.slice(0, 100)) {
    for (const v of (Array.isArray(d?.values) ? d.values : [d?.values]) as Array<{ field?: string; value?: { root_post?: { owner_id?: unknown } } }>) {
      // A reply names its account by the post's owner; target_id can be the post itself.
      const entryId = String(v?.value?.root_post?.owner_id ?? d?.target_id ?? "");
      if (v?.field && entryId) events.push({ platform: "threads", entryId, field: String(v.field), payload: v.value ?? {} });
    }
  }
  return events;
}

// Splits a delivery into one stored event per change (comments) or message (messaging).
export function eventsIn(body: unknown): StoredEvent[] {
  const delivery = (body ?? {}) as { object?: string; entry?: Array<Record<string, unknown>>; values?: unknown };
  if (Array.isArray(body) || delivery.values) return threadsEvents(body);
  const platform = delivery.object === "instagram" ? "instagram" : delivery.object === "page" ? "facebook" : null;
  if (!platform || !Array.isArray(delivery.entry)) return [];
  const events: StoredEvent[] = [];
  for (const entry of delivery.entry.slice(0, 100)) {
    const entryId = String(entry.id ?? "");
    if (!entryId) continue;
    for (const change of (Array.isArray(entry.changes) ? entry.changes : []) as Array<{ field?: string; value?: unknown }>) {
      if (change.field) events.push({ platform, entryId, field: String(change.field), payload: change.value ?? {} });
    }
    for (const message of (Array.isArray(entry.messaging) ? entry.messaging : []) as unknown[]) {
      events.push({ platform, entryId, field: "messages", payload: message });
    }
  }
  return events;
}

export async function storeEvents(sql: Sql, events: StoredEvent[]) {
  if (!events.length) return 0;
  await sql(
    `INSERT INTO public.inbox_webhook_events (platform, entry_id, field, payload)
     SELECT e->>'platform', e->>'entryId', e->>'field', e->'payload' FROM jsonb_array_elements($1::jsonb) e`,
    [JSON.stringify(events)],
  );
  return events.length;
}

// Each Meta app sends its webhooks to one address: prod's. So dev keeps getting live events
// for our own test accounts, prod passes those on to dev (META_WEBHOOK_FORWARD_URL, for the
// account ids in META_WEBHOOK_FORWARD_IDS). Meta can batch several accounts into one
// delivery, so dev gets a copy holding only the listed accounts, signed again with the same
// app secret: no other account's comments or messages ever reach dev.
export type WebhookForward = { url: string; ids: string[] };

export function forwardSettings(read: (name: string) => string | undefined): WebhookForward | null {
  const url = (read("META_WEBHOOK_FORWARD_URL") ?? "").trim();
  const ids = (read("META_WEBHOOK_FORWARD_IDS") ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  return /^https:\/\//.test(url) && ids.length ? { url, ids } : null;
}

// The part of a delivery about the listed accounts, in Meta's own shape; null when none.
export function onlyAccounts(body: unknown, ids: string[]): unknown | null {
  const wanted = new Set(ids);
  const delivery = (body ?? {}) as { object?: string; entry?: unknown; values?: unknown };
  if (Array.isArray(body) || delivery.values) {
    const kept = (Array.isArray(body) ? body : [body]).filter((d) => threadsEvents(d).some((e) => wanted.has(e.entryId)));
    return kept.length ? (Array.isArray(body) ? kept : kept[0]) : null;
  }
  if (!Array.isArray(delivery.entry)) return null;
  const entry = delivery.entry.filter((e) => wanted.has(String((e as { id?: unknown })?.id ?? "")));
  return entry.length ? { ...delivery, entry } : null;
}

async function forwardToDev(forward: WebhookForward, body: unknown, secret: string, http: typeof fetch) {
  const part = onlyAccounts(body, forward.ids);
  if (part === null) return false;
  const raw = JSON.stringify(part);
  try {
    // Prod's answer to Meta must not wait long on dev: a short limit, and a failure is ignored.
    await http(forward.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Hub-Signature-256": `sha256=${await hmacHex(secret, raw)}` },
      body: raw,
      signal: AbortSignal.timeout(3000),
    });
    return true;
  } catch {
    return false;
  }
}

// The whole POST: signed by Meta, then stored (and our test accounts' part passed to dev).
// Unsigned or badly signed deliveries are refused without storing anything.
export async function receiveWebhook(
  deps: { sql: Sql; appSecrets: string[]; forward?: WebhookForward | null; http?: typeof fetch },
  request: Request,
) {
  const raw = await request.text();
  if (raw.length > 1_000_000) return { status: 413, stored: 0, forwarded: false };
  const secret = await signingSecret(raw, request.headers.get("x-hub-signature-256"), deps.appSecrets);
  if (!secret) return { status: 401, stored: 0, forwarded: false };
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { status: 400, stored: 0, forwarded: false };
  }
  const stored = await storeEvents(deps.sql, eventsIn(body));
  const forwarded = deps.forward ? await forwardToDev(deps.forward, body, secret, deps.http ?? fetch) : false;
  return { status: 200, stored, forwarded };
}

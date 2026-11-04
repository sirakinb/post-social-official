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

// X-Hub-Signature-256 is "sha256=" + the HMAC of the raw body with the app's secret. Any of
// our Meta apps' secrets may have signed it.
export async function signatureValid(rawBody: string, header: string | null, secrets: string[]) {
  const sent = header?.startsWith("sha256=") ? header.slice(7).toLowerCase() : null;
  if (!sent || !/^[0-9a-f]{64}$/.test(sent)) return false;
  for (const secret of secrets) {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const expected = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sent.charCodeAt(i);
    if (diff === 0) return true;
  }
  return false;
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

// The whole POST: signed by Meta, then stored. Unsigned or badly signed deliveries are
// refused without storing anything.
export async function receiveWebhook(deps: { sql: Sql; appSecrets: string[] }, request: Request) {
  const raw = await request.text();
  if (raw.length > 1_000_000) return { status: 413, stored: 0 };
  if (!(await signatureValid(raw, request.headers.get("x-hub-signature-256"), deps.appSecrets))) return { status: 401, stored: 0 };
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { status: 400, stored: 0 };
  }
  return { status: 200, stored: await storeEvents(deps.sql, eventsIn(body)) };
}

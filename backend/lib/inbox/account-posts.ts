// An account's recent posts, read straight from the platform (Instagram, Facebook Pages,
// Threads), so an automation can be attached to any post on the account: published through
// Post Social or made in the platform's own app, seconds ago or months ago. Listing an
// account's own posts needs only its basic access, which every connection has.
import type { Sql } from "../access";
import type { Platform, Settings } from "../connections/platforms";
import { accountToken } from "../../../worker/src/credentials";

export type LivePost = {
  platform_post_id: string;
  caption: string | null;
  published_at: string;
  live_url: string | null;
  thumbnail_url: string | null;
  format: "video" | "carousel" | "photo" | "text";
};
export type LivePage = { posts: LivePost[]; next_cursor: string | null };
export type LiveDeps = { sql: Sql; setting: Settings; http?: typeof fetch };
export type LiveAccount = { id: string; platform: string; display_name: string; external_account_id: string };

export const PAGE_SIZE = 24;
const TIMEOUT_MS = 8000;
const IG = "https://graph.instagram.com/v25.0";
const FB = "https://graph.facebook.com/v25.0";
const TH = "https://graph.threads.net/v1.0";

// The platform's "next page" address carries our access token, so it never leaves the server.
// The cursor we hand out holds only its paging values, and only these are ever put back.
const PAGING_KEYS = ["after", "until", "since", "__paging_token"];
// Facebook's cursors run to about 800 characters.
export const MAX_CURSOR = 4000;
export function encodeCursor(nextUrl: unknown): string | null {
  if (typeof nextUrl !== "string" || !nextUrl) return null;
  try {
    const params = new URL(nextUrl).searchParams;
    const kept = PAGING_KEYS.flatMap((key) => (params.get(key) ? [[key, params.get(key)!]] : []));
    return kept.length ? btoa(JSON.stringify(kept)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : null;
  } catch {
    return null;
  }
}
export function decodeCursor(cursor: unknown): Array<[string, string]> {
  if (typeof cursor !== "string" || !cursor || cursor.length > MAX_CURSOR || !/^[A-Za-z0-9_-]+$/.test(cursor)) return [];
  try {
    const list = JSON.parse(atob(cursor.replace(/-/g, "+").replace(/_/g, "/"))) as unknown;
    if (!Array.isArray(list)) return [];
    return list.filter((pair): pair is [string, string] => Array.isArray(pair) && PAGING_KEYS.includes(pair[0]) && typeof pair[1] === "string" && pair[1].length <= 2500);
  } catch {
    return [];
  }
}

const clip = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim().slice(0, 160) : null);
const link = (value: unknown) => (typeof value === "string" && value.startsWith("https://") ? value : null);
const iso = (value: unknown) => {
  const ms = Date.parse(String(value ?? ""));
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
};
type Item = Record<string, unknown>;

const READERS: Record<string, { url: (account: LiveAccount) => string; post: (item: Item) => Omit<LivePost, "published_at"> & { published_at: string | null } }> = {
  instagram: {
    url: () => `${IG}/me/media?fields=id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp`,
    post: (m) => {
      const video = m.media_type === "VIDEO" || m.media_product_type === "REELS";
      return {
        platform_post_id: String(m.id ?? ""),
        caption: clip(m.caption),
        published_at: iso(m.timestamp),
        live_url: link(m.permalink),
        // A video's media_url is the video file; its picture is thumbnail_url.
        thumbnail_url: link(m.thumbnail_url) ?? (video ? null : link(m.media_url)),
        format: m.media_type === "CAROUSEL_ALBUM" ? "carousel" : video ? "video" : "photo",
      };
    },
  },
  facebook: {
    url: (account) => `${FB}/${encodeURIComponent(account.external_account_id)}/published_posts?fields=id,message,created_time,permalink_url,full_picture,attachments{media_type}`,
    post: (p) => {
      const type = (p.attachments as { data?: Array<{ media_type?: string }> } | undefined)?.data?.[0]?.media_type;
      return {
        platform_post_id: String(p.id ?? ""),
        caption: clip(p.message),
        published_at: iso(p.created_time),
        live_url: link(p.permalink_url),
        thumbnail_url: link(p.full_picture),
        format: type === "video" ? "video" : type === "album" ? "carousel" : type === "photo" ? "photo" : "text",
      };
    },
  },
  threads: {
    url: () => `${TH}/me/threads?fields=id,text,media_type,permalink,timestamp,thumbnail_url,media_url`,
    post: (t) => {
      const video = t.media_type === "VIDEO";
      return {
        platform_post_id: String(t.id ?? ""),
        caption: clip(t.text),
        published_at: iso(t.timestamp),
        live_url: link(t.permalink),
        thumbnail_url: link(t.thumbnail_url) ?? (video ? null : link(t.media_url)),
        format: t.media_type === "CAROUSEL_ALBUM" ? "carousel" : video ? "video" : t.media_type === "IMAGE" ? "photo" : "text",
      };
    },
  },
};

// Threads lists reposts of other people's posts among the account's own; replies to those
// never reach us, so they can't carry an automation.
const usable = (platform: string, item: Item) => !(platform === "threads" && item.media_type === "REPOST_FACADE");

// One page of the account's posts, newest first. Throws when the platform can't be read
// (expired access, an outage, a timeout); the caller falls back to the posts we have saved.
export async function liveAccountPosts(deps: LiveDeps, account: LiveAccount, cursor?: unknown): Promise<LivePage> {
  const reader = READERS[account.platform];
  if (!reader) throw new Error(`No post list for ${account.platform}.`);
  const token = await accountToken(deps, { id: account.id, platform: account.platform as Platform, displayName: account.display_name });
  const url = new URL(reader.url(account));
  url.searchParams.set("limit", String(PAGE_SIZE));
  for (const [key, value] of decodeCursor(cursor)) url.searchParams.set(key, value);
  url.searchParams.set("access_token", token);
  const response = await (deps.http ?? fetch)(url.toString(), { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = (await response.json().catch(() => null)) as { data?: Item[]; paging?: { next?: string }; error?: { message?: string } } | null;
  if (!response.ok || !body || body.error || !Array.isArray(body.data)) throw new Error(`The platform didn't return the posts (HTTP ${response.status}).`);
  const posts = body.data
    .filter((item) => usable(account.platform, item))
    .map(reader.post)
    .filter((post): post is LivePost => Boolean(post.platform_post_id && post.published_at && /^[0-9A-Za-z_]+$/.test(post.platform_post_id)));
  return { posts, next_cursor: body.data.length ? encodeCursor(body.paging?.next) : null };
}

// Whether a post id belongs to this account: true, false, or null when it can't be told just
// now (an outage, a timeout). An automation on another account's post would never fire, so
// saving one is refused, but only when the platform says clearly that the post isn't there.
export async function postOnAccount(deps: LiveDeps, account: LiveAccount, platformPostId: string): Promise<boolean | null> {
  if (account.platform === "facebook") return platformPostId.startsWith(`${account.external_account_id}_`);
  const base = account.platform === "instagram" ? IG : account.platform === "threads" ? TH : null;
  if (!base) return null;
  try {
    const token = await accountToken(deps, { id: account.id, platform: account.platform as Platform, displayName: account.display_name });
    const url = `${base}/${encodeURIComponent(platformPostId)}?fields=id&access_token=${encodeURIComponent(token)}`;
    const response = await (deps.http ?? fetch)(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (response.ok) return true;
    const body = (await response.json().catch(() => null)) as { error?: { code?: number } } | null;
    // 100: "Unsupported get request. Object with ID … does not exist, or cannot be loaded".
    return (response.status === 400 || response.status === 404) && body?.error?.code === 100 ? false : null;
  } catch {
    return null;
  }
}

// The photo links TikTok fetches (worker/src/publish/tiktok-photos.ts): /tiktok-media/<signed
// storage link, base64url>.jpg. TikTok only accepts photos from a domain we verified and
// never follows redirects, so the website fetches the file and passes the bytes on. Only
// signed links to a TikTok copy in our own storage are accepted, so the route can't be used
// to fetch anything else.
//
// "Our own storage" is pinned with the same settings the worker signs with: R2_ACCOUNT_ID
// (the storage host), R2_BUCKET and R2_ACCESS_KEY_ID (the key named in the signed link).
// Bucket names are only unique within one Cloudflare account, so without the account id a
// look-alike bucket in someone else's account would pass. Each setting that is present is
// enforced; until R2_ACCOUNT_ID is set on the website, any R2 account's host is accepted.
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ACCOUNT_ID = /^[0-9a-f]{32}$/;
const STORAGE_HOST = /^([0-9a-f]{32})\.r2\.cloudflarestorage\.com$/;
const TIKTOK_COPY = new RegExp(`^/(postsocial-media-(?:dev|prod))/workspaces/${UUID}/media/${UUID}/tiktok\\.jpg$`);

export const TIKTOK_MEDIA_MAX_BYTES = 4 * 1024 * 1024;

type StorageEnv = Record<string, string | undefined>;

// The signed storage link inside a /tiktok-media file name, or null if it isn't one of ours.
export function tiktokMediaSource(file: string, env: StorageEnv = process.env): string | null {
  const match = /^([A-Za-z0-9_-]{40,4000})\.jpg$/.exec(file);
  if (!match) return null;
  let url: URL;
  try {
    url = new URL(Buffer.from(match[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.port || url.username || url.password) return null;
  const host = STORAGE_HOST.exec(url.hostname);
  const path = TIKTOK_COPY.exec(url.pathname);
  if (!host || !path) return null;
  const accountId = env.R2_ACCOUNT_ID?.trim().toLowerCase();
  if (accountId && (!ACCOUNT_ID.test(accountId) || host[1] !== accountId)) return null;
  const bucket = env.R2_BUCKET?.trim();
  if (bucket && path[1] !== bucket) return null;
  if (!url.searchParams.get("X-Amz-Signature") || !url.searchParams.get("X-Amz-Expires")) return null;
  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim();
  if (accessKeyId && !(url.searchParams.get("X-Amz-Credential") ?? "").startsWith(`${accessKeyId}/`)) return null;
  return url.toString();
}

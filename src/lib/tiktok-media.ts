// The photo links TikTok fetches (worker/src/publish/tiktok-photos.ts): /tiktok-media/<signed
// storage link, base64url>.jpg. TikTok only accepts photos from a domain we verified and
// never follows redirects, so the website fetches the file and passes the bytes on. Only
// signed links to a TikTok copy in our own storage are accepted, so the route can't be used
// to fetch anything else.
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const STORAGE_HOST = /^[0-9a-f]{32}\.r2\.cloudflarestorage\.com$/;
const TIKTOK_COPY = new RegExp(`^/postsocial-media-(dev|prod)/workspaces/${UUID}/media/${UUID}/tiktok\\.jpg$`);

export const TIKTOK_MEDIA_MAX_BYTES = 4 * 1024 * 1024;

// The signed storage link inside a /tiktok-media file name, or null if it isn't one of ours.
export function tiktokMediaSource(file: string): string | null {
  const match = /^([A-Za-z0-9_-]{40,4000})\.jpg$/.exec(file);
  if (!match) return null;
  let url: URL;
  try {
    url = new URL(Buffer.from(match[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.port || url.username || url.password) return null;
  if (!STORAGE_HOST.test(url.hostname) || !TIKTOK_COPY.test(url.pathname)) return null;
  if (!url.searchParams.get("X-Amz-Signature") || !url.searchParams.get("X-Amz-Expires")) return null;
  return url.toString();
}

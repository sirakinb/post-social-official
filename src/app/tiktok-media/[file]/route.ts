import { TIKTOK_MEDIA_MAX_BYTES, tiktokMediaSource } from "@/lib/tiktok-media";

// TikTok fetches photo posts from here (see src/lib/tiktok-media.ts).
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const source = tiktokMediaSource((await params).file);
  if (!source) return new Response("Not found", { status: 404 });
  const upstream = await fetch(source, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(20_000) }).catch(() => null);
  if (!upstream?.ok) return new Response("Not found", { status: upstream?.status === 403 ? 410 : 404 });
  const bytes = await upstream.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > TIKTOK_MEDIA_MAX_BYTES) return new Response("Not available", { status: 404 });
  return new Response(bytes, {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, max-age=600",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex",
    },
  });
}

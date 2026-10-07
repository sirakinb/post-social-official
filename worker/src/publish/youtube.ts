// YouTube Shorts via the resumable upload protocol, streamed from storage in chunks so the
// worker never holds the whole file. If the worker stops mid-upload, the next run asks
// YouTube how many bytes it has and continues; if the upload already finished, YouTube
// returns the video instead, so it is never uploaded twice.
import { captionFor, type YouTubeOptions } from "../../../backend/lib/publishing/validate";
import { PublishError, type Adapter, type StepContext, type StepResult } from "./types";

const CHUNK = 32 * 256 * 1024 * 4; // 32 MiB, a multiple of 256 KiB as YouTube requires
const UPLOADS_PER_DAY = 6; // videos.insert costs 1,600 of the default 10,000 daily units

function nextMidnightPacific(now: number) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hourCycle: "h23", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const elapsed = ((Number(parts.hour) * 60 + Number(parts.minute)) * 60 + Number(parts.second)) * 1000;
  return new Date(now + (24 * 3600_000 - elapsed) + 60_000);
}

async function failure(response: Response, what: string, now: number): Promise<never> {
  const text = await response.text();
  if (response.status === 401) throw new PublishError("access_expired", "YouTube refused the account's access. Reconnect YouTube and try again.", false, undefined, true);
  if (text.includes("quotaExceeded") || text.includes("uploadLimitExceeded")) {
    throw new PublishError("youtube_quota", "YouTube's daily upload limit is used up. Post Social will try again after it resets at midnight Pacific time.", true, nextMidnightPacific(now));
  }
  const message = text.match(/"message":\s*"([^"]+)"/)?.[1];
  throw new PublishError(`http_${response.status}`, `${what} failed${message ? `: ${message}` : ` (${response.status})`}.`, response.status >= 500 || response.status === 429);
}

function withShortsTag(title: string) {
  if (/#shorts/i.test(title)) return title;
  const tagged = `${title} #Shorts`;
  return tagged.length <= 100 ? tagged : title;
}

// The finished video names its channel, which is how the account learns its real name.
async function finished(response: Response) {
  const video = (await response.json()) as { id: string; snippet?: { channelTitle?: string } };
  const channel = video.snippet?.channelTitle?.trim();
  return {
    kind: "published" as const,
    platformId: video.id,
    liveUrl: `https://www.youtube.com/shorts/${video.id}`,
    ...(channel ? { profile: { displayName: channel.slice(0, 200) } } : {}),
  };
}

// Asks YouTube how much of the upload it has. Returns the next byte to send, or the
// finished video.
async function uploadStatus(ctx: StepContext, uploadUrl: string, size: number) {
  const response = await ctx.http(uploadUrl, { method: "PUT", headers: { "Content-Range": `bytes */${size}`, Authorization: `Bearer ${await ctx.token()}` } });
  if (response.status === 200 || response.status === 201) return { done: await finished(response) };
  if (response.status === 308) {
    const range = response.headers.get("range");
    return { offset: range ? Number(range.split("-")[1]) + 1 : 0 };
  }
  if (response.status === 404 || response.status === 410) return { expired: true };
  return failure(response, "Checking the YouTube upload", ctx.now());
}

// A custom thumbnail (cover image, or a frame of the video). The video is already up, so a
// refusal never fails the post; it becomes a note. YouTube only allows custom thumbnails on
// channels that have unlocked them (usually by phone verification).
async function setThumbnail(ctx: StepContext, result: StepResult): Promise<StepResult> {
  if (result.kind !== "published" || !result.platformId || !ctx.cover) return result;
  const options = ctx.bundle.options;
  if (!options.cover_media_id && options.cover_time_ms === undefined) return result;
  try {
    const jpeg = options.cover_media_id && ctx.cover.image ? (await ctx.cover.image()).bytes : await ctx.cover.frame(options.cover_time_ms ?? 0);
    const r = await ctx.http(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(result.platformId)}&uploadType=media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await ctx.token()}`, "Content-Type": "image/jpeg", "Content-Length": String(jpeg.byteLength) },
      body: jpeg,
    });
    if (!r.ok) {
      const text = await r.text();
      const message = text.match(/"message":\s*"([^"]+)"/)?.[1];
      ctx.notes.push(r.status === 403
        ? "Posted, but YouTube didn't accept the custom thumbnail: this channel can't use custom thumbnails yet (YouTube unlocks them after phone verification)."
        : `Posted, but YouTube didn't accept the custom thumbnail${message ? `: ${message}` : ""}.`);
    }
  } catch (error) {
    ctx.notes.push(`Posted, but the custom thumbnail couldn't be prepared: ${error instanceof Error ? error.message : "unknown error"}.`);
  }
  return result;
}

export const publishYouTube: Adapter = async (ctx) => setThumbnail(ctx, await upload(ctx));

const upload: Adapter = async (ctx) => {
  const options = ctx.bundle.options as YouTubeOptions;
  const video = ctx.bundle.media[0];
  const size = video.size_bytes;

  if (!ctx.checkpoint.upload_url) {
    await ctx.reserve("video_upload", UPLOADS_PER_DAY, 24 * 3600);
    const init = await ctx.http("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await ctx.token()}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": String(size),
        "X-Upload-Content-Type": video.mime_type,
      },
      body: JSON.stringify({
        snippet: { title: withShortsTag(options.title.trim()), description: captionFor(options, ctx.bundle.caption), categoryId: "22" },
        status: { privacyStatus: options.privacy_status, selfDeclaredMadeForKids: false },
      }),
    });
    if (!init.ok) await failure(init, "Starting the YouTube upload", ctx.now());
    const uploadUrl = init.headers.get("location");
    if (!uploadUrl) throw new PublishError("youtube_no_session", "YouTube did not start the upload.", true);
    // Creating the session publishes nothing; the video exists only once all bytes arrive.
    await ctx.save({ upload_url: uploadUrl, publish_started_at: new Date(ctx.now()).toISOString() });
  }

  const uploadUrl = String(ctx.checkpoint.upload_url);
  const status = await uploadStatus(ctx, uploadUrl, size);
  if ("done" in status && status.done) return status.done;
  if ("expired" in status) {
    // The session expired before finishing, so no video was created. Start a new one.
    await ctx.save({ upload_url: null, publish_started_at: null });
    throw new PublishError("youtube_session_expired", "The YouTube upload session expired; starting again.", true);
  }

  let offset = status.offset ?? 0;
  while (offset < size) {
    const end = Math.min(offset + CHUNK, size) - 1;
    const source = await ctx.http(video.url, { headers: { Range: `bytes=${offset}-${end}` } });
    if (source.status !== 206 && !(source.status === 200 && offset === 0 && end === size - 1)) {
      throw new PublishError("media_unavailable", "The stored video could not be read.", true);
    }
    const bytes = new Uint8Array(await source.arrayBuffer());
    const put = await ctx.http(uploadUrl, {
      method: "PUT",
      headers: { Authorization: `Bearer ${await ctx.token()}`, "Content-Length": String(bytes.byteLength), "Content-Range": `bytes ${offset}-${offset + bytes.byteLength - 1}/${size}` },
      body: bytes,
    });
    if (put.status === 200 || put.status === 201) return finished(put);
    if (put.status !== 308) await failure(put, "Uploading to YouTube", ctx.now());
    const range = put.headers.get("range");
    offset = range ? Number(range.split("-")[1]) + 1 : offset;
    await ctx.save({ uploaded_bytes: offset });
    await ctx.renewLease();
  }
  // All bytes sent but no final response: ask once more.
  const last = await uploadStatus(ctx, uploadUrl, size);
  if ("done" in last && last.done) return last.done;
  return { kind: "wait", afterMs: 10_000, message: "Waiting for YouTube to confirm the upload." };
};

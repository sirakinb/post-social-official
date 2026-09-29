export const TIKTOK_MAX_VIDEO_BYTES = 1024 * 1024 * 1024;
export const TIKTOK_MAX_CHUNK_BYTES = 64 * 1024 * 1024;

export function buildTikTokChunkPlan(videoSize: number) {
  if (!Number.isSafeInteger(videoSize) || videoSize <= 0) throw new Error("media_size_missing");
  if (videoSize > TIKTOK_MAX_VIDEO_BYTES) throw new Error("video_too_large");
  const chunkSize = Math.min(videoSize, TIKTOK_MAX_CHUNK_BYTES);
  const ranges = [] as { start: number; end: number; length: number }[];
  for (let start = 0; start < videoSize; start += chunkSize) {
    const end = Math.min(start + chunkSize, videoSize) - 1;
    ranges.push({ start, end, length: end - start + 1 });
  }
  return { videoSize, chunkSize, totalChunkCount: ranges.length, ranges };
}

export function rateWindowStart(now: number, windowMs: number) {
  if (!Number.isFinite(now) || !Number.isFinite(windowMs) || windowMs <= 0) throw new Error("invalid_rate_window");
  return Math.floor(now / windowMs) * windowMs;
}

export type InstagramMediaInput = { mediaType: "image" | "video"; url?: string | null };

export function buildInstagramCarouselPlan(media: InstagramMediaInput[]) {
  if (media.length < 2) throw new Error("carousel_needs_two_items");
  if (media.length > 10) throw new Error("carousel_too_many_items");
  if (media.some((item) => !item.url)) throw new Error("carousel_media_missing");
  return media.map((item, index) => ({ index, mediaType: item.mediaType, url: item.url as string }));
}

export function platformResponseError(responseOk: boolean, status: number, error: unknown) {
  if (!responseOk) return typeof error === "object" && error && "code" in error ? String((error as { code: unknown }).code) : `http_${status}`;
  if (!error) return undefined;
  if (typeof error === "object" && "code" in error && (error as { code: unknown }).code === "ok") return undefined;
  return typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : `http_${status}`;
}

export function assertConnectionWorkspace(existingWorkspaceId: string | undefined, targetWorkspaceId: string) {
  if (existingWorkspaceId && existingWorkspaceId !== targetWorkspaceId) {
    throw new Error("This social account is already connected to another workspace.");
  }
}

export function canPublishToFacebookPage(tasks: unknown): boolean {
  const publishingTasks = new Set([
    "CREATE_CONTENT",
    "MANAGE",
    "PROFILE_PLUS_CREATE_CONTENT",
    "PROFILE_PLUS_MANAGE",
    "PROFILE_PLUS_FULL_CONTROL",
  ]);
  return Array.isArray(tasks) && tasks.some((task) => typeof task === "string" && publishingTasks.has(task));
}

export type TikTokStatusOutcome =
  | { kind: "published"; postId?: string }
  | { kind: "failed"; reason: string }
  | { kind: "processing" }
  | { kind: "timed_out" };

export function classifyTikTokStatus(data: Record<string, unknown>, createdAt: number, now: number): TikTokStatusOutcome {
  const status = String(data.status ?? "");
  if (status === "PUBLISH_COMPLETE") {
    const rawIds = data.publicly_available_post_id ?? data.publicaly_available_post_id;
    const postId = Array.isArray(rawIds) ? rawIds[0] : rawIds;
    return { kind: "published", postId: postId ? String(postId) : undefined };
  }
  if (status === "FAILED") return { kind: "failed", reason: String(data.fail_reason ?? "tiktok_publish_failed") };
  if (now - createdAt > 10 * 60 * 1000) return { kind: "timed_out" };
  return { kind: "processing" };
}

/**
 * YouTube's daily quota resets at midnight Pacific time. A one-minute buffer
 * absorbs clock skew and DST boundaries around the reset moment.
 */
export function nextMidnightPacific(now: number): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
  const elapsedMs = ((Number(parts.hour) * 60 + Number(parts.minute)) * 60 + Number(parts.second)) * 1000;
  return now + (24 * 60 * 60 * 1000 - elapsedMs) + 60 * 1000;
}

export type ThreadsContainerOutcome =
  | { kind: "ready" }
  | { kind: "failed"; reason: string }
  | { kind: "processing" };

export function classifyThreadsContainerStatus(data: Record<string, unknown>): ThreadsContainerOutcome {
  const status = String(data.status ?? "").toUpperCase();
  if (status === "FINISHED") return { kind: "ready" };
  if (status === "ERROR" || status === "EXPIRED") {
    return {
      kind: "failed",
      reason: String(data.error_message ?? "Threads could not prepare the image."),
    };
  }
  return { kind: "processing" };
}

// Instagram (Instagram Login) and Threads: both publish through single-use media
// containers. A container can only be published once, and its status turns PUBLISHED when
// it was, so a retry after a crash can always tell what happened.
import { captionFor } from "../../../backend/lib/publishing/validate";
import { PublishError, platformJson, type Adapter, type PublishMedia, type StepContext } from "./types";

type Flavor = {
  name: "Instagram" | "Threads";
  base: string; // API root including version
  containerPath: (userId: string) => string;
  publishPath: (userId: string) => string;
  listPath: (userId: string) => string;
  statusFields: string;
};

const IG: Flavor = {
  name: "Instagram",
  base: "https://graph.instagram.com/v25.0",
  containerPath: (id) => `/${id}/media`,
  publishPath: (id) => `/${id}/media_publish`,
  listPath: (id) => `/${id}/media`,
  statusFields: "status_code,status",
};

const THREADS: Flavor = {
  name: "Threads",
  base: "https://graph.threads.net/v1.0",
  containerPath: (id) => `/${id}/threads`,
  publishPath: (id) => `/${id}/threads_publish`,
  listPath: (id) => `/${id}/threads`,
  statusFields: "status,error_message",
};

async function call(ctx: StepContext, flavor: Flavor, method: "GET" | "POST", path: string, params: Record<string, string>, what: string) {
  const token = await ctx.token();
  const url = new URL(flavor.base + path);
  if (method === "GET") {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("access_token", token);
    return platformJson(await ctx.http(url), what);
  }
  return platformJson(await ctx.http(url, { method: "POST", body: new URLSearchParams({ ...params, access_token: token }) }), what);
}

// FINISHED, PUBLISHED, IN_PROGRESS, ERROR or EXPIRED (Instagram uses status_code).
async function containerStatus(ctx: StepContext, flavor: Flavor, id: string) {
  const body = await call(ctx, flavor, "GET", `/${id}`, { fields: flavor.statusFields }, `Checking the ${flavor.name} upload`);
  const status = String(body.status_code ?? body.status ?? "").toUpperCase();
  const detail = String(body.error_message ?? body.status ?? "");
  return { status, detail };
}

function mediaParams(flavor: Flavor, item: PublishMedia, child: boolean): Record<string, string> {
  if (flavor.name === "Instagram") {
    if (item.media_type === "video") return child ? { media_type: "VIDEO", video_url: item.url, is_carousel_item: "true" } : { media_type: "REELS", video_url: item.url, share_to_feed: "true" };
    return child ? { image_url: item.url, is_carousel_item: "true" } : { image_url: item.url };
  }
  const base: Record<string, string> = item.media_type === "video" ? { media_type: "VIDEO", video_url: item.url } : { media_type: "IMAGE", image_url: item.url };
  return child ? { ...base, is_carousel_item: "true" } : base;
}

// A Reel's cover: a library image (Instagram fetches it by link; JPEG, ≤ 8 MB) or a frame of
// the video. If the image can't be prepared, the Reel still goes out with its first frame.
async function reelCover(ctx: StepContext): Promise<Record<string, string>> {
  const { options } = ctx.bundle;
  if (options.cover_media_id && ctx.cover?.image) {
    try {
      return { cover_url: (await ctx.cover.image()).link };
    } catch (error) {
      ctx.notes.push(`The cover image couldn't be prepared (${error instanceof Error ? error.message : "unknown error"}), so Instagram used the first frame.`);
      return {};
    }
  }
  return options.cover_time_ms !== undefined ? { thumb_offset: String(options.cover_time_ms) } : {};
}

async function createContainer(ctx: StepContext, flavor: Flavor) {
  const { bundle } = ctx;
  const userId = bundle.account.externalId;
  const caption = captionFor(bundle.options, bundle.caption);
  const textKey = flavor.name === "Instagram" ? "caption" : "text";
  const kind = bundle.options.kind === "instagram" || bundle.options.kind === "threads" ? bundle.options.media_type : "text";

  if (kind === "carousel") {
    // Children first; saved one by one so a retry continues instead of starting over.
    const children = Array.isArray(ctx.checkpoint.children) ? [...(ctx.checkpoint.children as string[])] : [];
    for (let i = children.length; i < bundle.media.length; i++) {
      const child = await call(ctx, flavor, "POST", flavor.containerPath(userId), mediaParams(flavor, bundle.media[i], true), `Uploading carousel item ${i + 1} to ${flavor.name}`);
      children.push(String(child.id));
      await ctx.save({ children });
    }
    for (const [i, id] of children.entries()) {
      const { status, detail } = await containerStatus(ctx, flavor, id);
      if (status === "ERROR" || status === "EXPIRED") throw new PublishError("container_failed", `${flavor.name} could not process carousel item ${i + 1}: ${detail || status.toLowerCase()}.`);
      if (status !== "FINISHED") return false;
    }
    const parent = await call(ctx, flavor, "POST", flavor.containerPath(userId), { media_type: "CAROUSEL", children: children.join(","), [textKey]: caption }, `Preparing the ${flavor.name} carousel`);
    await ctx.save({ container_id: String(parent.id) });
    return true;
  }

  const params: Record<string, string> = kind === "text" ? { media_type: "TEXT" } : mediaParams(flavor, bundle.media[0], false);
  if (caption) params[textKey] = caption;
  if (flavor.name === "Instagram" && kind === "reel") Object.assign(params, await reelCover(ctx));
  const container = await call(ctx, flavor, "POST", flavor.containerPath(userId), params, `Uploading to ${flavor.name}`);
  await ctx.save({ container_id: String(container.id) });
  return true;
}

async function findPublished(ctx: StepContext, flavor: Flavor, publishedId?: string) {
  if (publishedId) {
    const media = await call(ctx, flavor, "GET", `/${publishedId}`, { fields: "permalink" }, `Reading the ${flavor.name} post`).catch(() => ({}) as Record<string, unknown>);
    return { kind: "published" as const, platformId: publishedId, liveUrl: typeof media.permalink === "string" ? media.permalink : undefined };
  }
  // Resuming after a crash: the container says PUBLISHED but the post id was not saved.
  // Take the newest post made since the publish call started.
  const startedAt = Date.parse(String(ctx.checkpoint.publish_started_at)) - 5 * 60_000;
  const list = await call(ctx, flavor, "GET", flavor.listPath(ctx.bundle.account.externalId), { fields: "id,permalink,timestamp", limit: "10" }, `Finding the ${flavor.name} post`);
  const match = (list.data as Array<{ id: string; permalink?: string; timestamp?: string }> | undefined)?.find((m) => !m.timestamp || Date.parse(m.timestamp) >= startedAt);
  return { kind: "published" as const, platformId: match?.id, liveUrl: match?.permalink, note: match ? undefined : `Published on ${flavor.name}; the link could not be found.` };
}

function containerAdapter(flavor: Flavor): Adapter {
  return async (ctx) => {
    const { bundle } = ctx;
    if (!ctx.checkpoint.container_id) {
      if (flavor.name === "Instagram") await ctx.reserve("media_publish", 100, 24 * 3600);
      else await ctx.reserve("threads_publish", 250, 24 * 3600);
      const ready = await createContainer(ctx, flavor);
      if (!ready) return { kind: "wait", afterMs: 10_000, message: `${flavor.name} is processing the carousel videos.` };
    }
    const containerId = String(ctx.checkpoint.container_id);
    const { status, detail } = await containerStatus(ctx, flavor, containerId).catch((error) => {
      // Threads text containers are not always readable; give them a moment, then publish.
      if (flavor.name === "Threads" && bundle.options.kind === "threads" && bundle.options.media_type === "text") return { status: "FINISHED", detail: "" };
      throw error;
    });

    if (status === "PUBLISHED") return findPublished(ctx, flavor, ctx.checkpoint.published_id as string | undefined);
    if (status === "ERROR") throw new PublishError("container_failed", `${flavor.name} could not process the media: ${detail || "unknown error"}.`);
    if (status === "EXPIRED") {
      // The container expired before publishing; nothing was posted. Start over.
      await ctx.save({ container_id: null, children: null, publish_started_at: null });
      throw new PublishError("container_expired", `${flavor.name} discarded the upload before it was published; trying again.`, true);
    }
    if (status !== "FINISHED") return { kind: "wait", afterMs: 10_000, message: `${flavor.name} is processing the media.` };

    // A container can be published only once, so this call is safe to repeat.
    await ctx.save({ publish_started_at: new Date(ctx.now()).toISOString() });
    const published = await call(ctx, flavor, "POST", flavor.publishPath(bundle.account.externalId), { creation_id: containerId }, `Publishing to ${flavor.name}`);
    await ctx.save({ published_id: String(published.id) });
    return findPublished(ctx, flavor, String(published.id));
  };
}

export const publishInstagram = containerAdapter(IG);
export const publishThreads = containerAdapter(THREADS);

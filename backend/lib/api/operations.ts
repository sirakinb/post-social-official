// Every Post Social capability for AIs and developers, defined once. The REST API, the MCP
// tools, the OpenAPI document (and later the CLI) are all generated from this list, so they
// cannot drift apart. Each operation runs the same service code as the web app.
import { ApiError, requireUuid, type AgentCaller, type Sql } from "../access";
import { DISPLAY_NAMES, PLATFORMS, type Platform } from "../connections/platforms";
import { ANALYTICS_PERIODS, listAnalytics, postAnalytics, refreshAnalytics } from "../analytics";
import { mediaActions, type MediaDeps } from "../media/service";
import type { R2 } from "../media/r2";
import { postActions } from "../publishing/service";
import { listAccounts, listMedia, listPosts, listResults } from "./reads";
import { PERIODS, usageReport } from "../usage";

export type ApiDeps = {
  sql: Sql;
  r2: R2;
  newId: () => string;
  webAppUrl: string;
  analyticsPlatforms: Platform[]; // platforms whose stats are switched on here (none: no stats tools)
};

type JsonSchema = Record<string, unknown>;
export type Operation = {
  name: string;
  title: string;
  description: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string; // `{name}` segments are taken from the input
  input: { properties: Record<string, JsonSchema>; required?: string[] };
  readOnly?: boolean;
  destructive?: boolean;
  creates?: boolean; // REST answers 201 Created
  analytics?: boolean; // only offered where stats are switched on
  run: (deps: ApiDeps, caller: AgentCaller, input: Record<string, unknown>) => Promise<unknown>;
};

const id = (what: string): JsonSchema => ({ type: "string", format: "uuid", description: `The ${what} id.` });
const paging = {
  limit: { type: "integer", minimum: 1, maximum: 100, default: 25, description: "How many to return (1 to 100)." },
  offset: { type: "integer", minimum: 0, default: 0, description: "How many to skip, for paging." },
};
const schedule: JsonSchema = {
  type: "string",
  format: "date-time",
  description: "When to publish, in ISO 8601 with a timezone, e.g. 2026-10-05T15:00:00Z. Leave out to publish as soon as possible. Up to a year ahead.",
};

const OPTIONS_HELP = [
  "Per-platform settings. media_type is required for Instagram, Facebook and Threads.",
  "instagram: media_type image | reel | carousel; caption (overrides the shared caption).",
  "facebook: media_type text | link | image | reel | video; message (overrides caption); link (for link posts); title (videos).",
  "threads: media_type text | image | video | carousel; text (overrides caption).",
  "youtube (Shorts, one vertical video up to 3 min): title (required, up to 100 characters); description; privacy_status public | unlisted | private (required).",
  "Video covers (any platform's options): cover_media_id (an image from list_media) or cover_time_ms (a frame, in milliseconds from the start), not both. Instagram Reels and YouTube take either; TikTok direct posts take a frame only; LinkedIn videos take either; TikTok drafts, Facebook and Threads can't set a cover. Instagram crops the cover to a centred square in the profile grid.",
  "tiktok: delivery_mode must be inbox for AI posts (it goes to the creator's TikTok inbox, where they tap Post; TikTok requires the creator to confirm); media_type video (one video) | photo (1 to 35 images as a swipeable carousel; JPEG, PNG or WebP, resized for TikTok automatically), left out it follows the media; title (photo posts only, up to 90 characters); comments_enabled, duet_enabled, stitch_enabled (default off; Duet and Stitch are video only); disclose_your_brand, disclose_branded_content; ai_generated.",
  "linkedin (the member's own profile): media_type text | image | video, left out it follows the media; text (overrides caption, up to 3,000 characters); title (videos); visibility PUBLIC (default) | CONNECTIONS. Images: 1 to 20 JPEG, PNG or GIF (2 or more show as a gallery). Videos: one MP4, 3 seconds to 30 minutes, up to 500 MB.",
].join(" ");

const destinations: JsonSchema = {
  type: "array",
  minItems: 1,
  maxItems: 20,
  description: "Where the post goes: one entry per connected account (ids from list_social_accounts).",
  items: {
    type: "object",
    required: ["account_id"],
    properties: { account_id: id("connected account"), options: { type: "object", description: OPTIONS_HELP, additionalProperties: true } },
  },
};
const postBody = {
  caption: { type: "string", maxLength: 10000, description: "The shared caption. Each platform's limit is checked (see list_social_accounts capabilities)." },
  media_ids: { type: "array", maxItems: 35, items: { type: "string", format: "uuid" }, description: "Media to attach, in order (ids from list_media, import_media or an upload)." },
  destinations,
  scheduled_at: schedule,
};

const mediaDeps = (deps: ApiDeps): MediaDeps => ({ sql: deps.sql, r2: deps.r2, newId: deps.newId });

// A plain next step for an AI to relay, based on where the post ended up.
function nextStep(post: { status: string; scheduled_at: string | null }) {
  switch (post.status) {
    case "draft":
      return "Saved as a draft. Call publish_post to send it (or schedule it).";
    case "awaiting_approval":
      return "Waiting for approval in Post Social before it goes out (this account is set to ask first).";
    case "scheduled":
      return `Scheduled for ${post.scheduled_at}.`;
    case "processing":
    case "approved":
      return "Publishing now. Check list_post_results in a minute for live links.";
    default:
      return undefined;
  }
}
const withNextStep = <T extends { status: string; scheduled_at: string | null }>(post: T) => ({ ...post, next_step: nextStep(post) });

export const operations: Operation[] = [
  {
    name: "get_workspace",
    title: "Who am I",
    description: "Shows which Post Social workspace this key acts for, the key's name, and whether it is a live or test key (test keys cannot publish).",
    method: "GET",
    path: "/v1/me",
    input: { properties: {} },
    readOnly: true,
    run: async (deps, caller) => {
      const [workspace] = await deps.sql<{ id: string; name: string }>(`SELECT id, name FROM public.workspaces WHERE id = $1`, [caller.workspaceId]);
      return { workspace, key: { name: caller.displayName, mode: caller.mode } };
    },
  },
  {
    name: "list_social_accounts",
    title: "List connected accounts",
    description: "Lists the social accounts connected to Post Social, with their ids, health and what each can post (capabilities and limits).",
    method: "GET",
    path: "/v1/accounts",
    input: { properties: { platform: { type: "string", enum: PLATFORMS, description: "Only this platform." } } },
    readOnly: true,
    run: (deps, caller, input) => listAccounts(deps.sql, caller, { ...input, workspace_id: caller.workspaceId }, deps.webAppUrl),
  },
  {
    name: "request_connect_link",
    title: "Get a link to connect an account",
    description: "Returns a link the person opens to connect a social account in Post Social. Accounts can only be connected by the person, never by an AI.",
    method: "POST",
    path: "/v1/accounts/connect-link",
    input: { properties: { platform: { type: "string", enum: PLATFORMS } }, required: ["platform"] },
    run: async (deps, _caller, input) => {
      if (!PLATFORMS.includes(input.platform as never)) throw new ApiError(400, `Choose a platform: ${PLATFORMS.join(", ")}.`);
      const url = new URL("/beta/accounts", deps.webAppUrl);
      url.searchParams.set("connect", String(input.platform));
      return { url: url.toString(), message: `Open this link to connect ${DISPLAY_NAMES[input.platform as keyof typeof DISPLAY_NAMES]}. You will sign in to Post Social first.` };
    },
  },
  {
    name: "list_media",
    title: "List media",
    description: "Lists uploaded and imported media, newest first. Only media with status ready can be posted.",
    method: "GET",
    path: "/v1/media",
    input: { properties: { media_type: { type: "string", enum: ["image", "video"] }, include_hidden: { type: "boolean", default: false }, ...paging } },
    readOnly: true,
    run: (deps, caller, input) => listMedia(deps.sql, caller, { ...input, workspace_id: caller.workspaceId }),
  },
  {
    name: "get_media",
    title: "Get one media item",
    description: "Gets a media item's details and status. Ready items include a temporary view link (valid 1 hour).",
    method: "GET",
    path: "/v1/media/{media_id}",
    input: { properties: { media_id: id("media") }, required: ["media_id"] },
    readOnly: true,
    run: async (deps, caller, input) => {
      const asset = await mediaActions.get(mediaDeps(deps), caller, input);
      if (asset.status !== "ready") return asset;
      const [row] = await deps.sql<{ storage_key: string }>(`SELECT storage_key FROM public.media_assets WHERE id = $1`, [asset.id]);
      return { ...asset, view_url: await deps.r2.presignGet(row.storage_key, 3600) };
    },
  },
  {
    name: "import_media",
    creates: true,
    title: "Import media from a link",
    description: "Copies an image or video from a public https link into Post Social. It is checked in the background; poll get_media until status is ready (or failed, with a reason).",
    method: "POST",
    path: "/v1/media/import",
    input: { properties: { url: { type: "string", format: "uri", description: "A public https link to the file." }, name: { type: "string", maxLength: 200 } }, required: ["url"] },
    run: (deps, caller, input) => mediaActions.import(mediaDeps(deps), caller, { ...input, workspace_id: caller.workspaceId }),
  },
  {
    name: "start_media_upload",
    creates: true,
    title: "Start uploading a file",
    description: "For tools that can send files (CLI, scripts). Returns upload links: PUT each part's bytes to its url, keep each response's ETag, then call finish_media_upload. Links last 1 hour.",
    method: "POST",
    path: "/v1/media/uploads",
    input: {
      properties: {
        file_name: { type: "string", maxLength: 200 },
        mime_type: { type: "string", description: "image/jpeg, image/png, image/webp, video/mp4 or video/quicktime." },
        size_bytes: { type: "integer", minimum: 1 },
      },
      required: ["file_name", "mime_type", "size_bytes"],
    },
    run: (deps, caller, input) => mediaActions.create_upload(mediaDeps(deps), caller, { ...input, workspace_id: caller.workspaceId }),
  },
  {
    name: "finish_media_upload",
    title: "Finish an upload",
    description: "Completes an upload started with start_media_upload. The file is then checked in the background; poll get_media until status is ready.",
    method: "POST",
    path: "/v1/media/{media_id}/complete",
    input: {
      properties: {
        media_id: id("media"),
        parts: { type: "array", items: { type: "object", required: ["part_number", "etag"], properties: { part_number: { type: "integer" }, etag: { type: "string" } } } },
      },
      required: ["media_id", "parts"],
    },
    run: (deps, caller, input) => mediaActions.complete_upload(mediaDeps(deps), caller, input),
  },
  {
    name: "delete_media",
    title: "Remove media from the library",
    description: "Removes a media item from the library. Files used by a post are kept until that post no longer needs them; unused files are deleted automatically later.",
    method: "DELETE",
    path: "/v1/media/{media_id}",
    input: { properties: { media_id: id("media") }, required: ["media_id"] },
    destructive: true,
    run: (deps, caller, input) => mediaActions.set_hidden(mediaDeps(deps), caller, { media_id: input.media_id, hidden: true }),
  },
  {
    name: "validate_post",
    title: "Check a post before sending",
    description: "Checks a proposed post against every chosen platform's rules (caption length, media shape and length, post types) without saving anything. Returns plain-language problems per account.",
    method: "POST",
    path: "/v1/posts/validate",
    input: { properties: { caption: postBody.caption, media_ids: postBody.media_ids, destinations }, required: ["destinations"] },
    readOnly: true,
    run: (deps, caller, input) => postActions.validate({ sql: deps.sql }, caller, { ...input, post_id: undefined, workspace_id: caller.workspaceId }),
  },
  {
    name: "create_post",
    creates: true,
    title: "Create a post",
    description:
      "Creates a post for one or more accounts and publishes it now, or at scheduled_at, unless draft is true. To schedule a series, call it once per post with each time. The result's next_step says what happens. If the post has problems it is saved as a draft and the problems are returned.",
    method: "POST",
    path: "/v1/posts",
    input: { properties: { ...postBody, draft: { type: "boolean", default: false, description: "Only save a draft; do not send or schedule." } }, required: ["destinations"] },
    run: async (deps, caller, input) => {
      const draft = input.draft === true;
      if (!draft && caller.mode === "test") throw new ApiError(403, "Test keys cannot publish or schedule. Pass draft: true, or use a live key.");
      const created = await postActions.create({ sql: deps.sql }, caller, { ...input, workspace_id: caller.workspaceId });
      if (draft) return withNextStep(created);
      if (!created.check.ok) {
        return { ...created, next_step: `Saved as a draft because of these problems: ${created.check.problems.join(" ")} Fix them with update_post, then call publish_post.` };
      }
      return withNextStep(await postActions.submit({ sql: deps.sql }, caller, { post_id: created.id }));
    },
  },
  {
    name: "list_posts",
    title: "List posts",
    description: "Lists posts, newest first, with each account's status and live link.",
    method: "GET",
    path: "/v1/posts",
    input: {
      properties: {
        status: { type: "string", enum: ["draft", "awaiting_approval", "approved", "scheduled", "processing", "published", "partially_published", "failed", "cancelled"] },
        platform: { type: "string", enum: PLATFORMS },
        ...paging,
      },
    },
    readOnly: true,
    run: (deps, caller, input) => listPosts(deps.sql, caller, { ...input, workspace_id: caller.workspaceId }),
  },
  {
    name: "get_post",
    title: "Get a post",
    description: "Gets one post with its caption, media, each account's status, live links and errors, and its approval state.",
    method: "GET",
    path: "/v1/posts/{post_id}",
    input: { properties: { post_id: id("post") }, required: ["post_id"] },
    readOnly: true,
    run: async (deps, caller, input) => withNextStep(await postActions.get({ sql: deps.sql }, caller, input)),
  },
  {
    name: "update_post",
    title: "Edit a post",
    description:
      "Edits a draft, a post waiting for approval, or a scheduled post. Only the fields you pass change; destinations replaces the whole list. Editing an approved or scheduled post may send it back for approval.",
    method: "PATCH",
    path: "/v1/posts/{post_id}",
    input: { properties: { post_id: id("post"), ...postBody }, required: ["post_id"] },
    run: async (deps, caller, input) => withNextStep(await postActions.update({ sql: deps.sql }, caller, input)),
  },
  {
    name: "publish_post",
    title: "Send a draft",
    description: "Publishes a draft now, or schedules it with scheduled_at.",
    method: "POST",
    path: "/v1/posts/{post_id}/publish",
    input: { properties: { post_id: id("post"), scheduled_at: schedule }, required: ["post_id"] },
    run: async (deps, caller, input) => withNextStep(await postActions.submit({ sql: deps.sql }, caller, input)),
  },
  {
    name: "reschedule_post",
    title: "Move a scheduled post",
    description: "Changes the time of a scheduled post that has not started sending.",
    method: "POST",
    path: "/v1/posts/{post_id}/reschedule",
    input: { properties: { post_id: id("post"), scheduled_at: { ...schedule, description: "The new time, ISO 8601 with a timezone." } }, required: ["post_id", "scheduled_at"] },
    run: async (deps, caller, input) => withNextStep(await postActions.reschedule({ sql: deps.sql }, caller, input)),
  },
  {
    name: "cancel_post",
    title: "Cancel a post",
    description: "Cancels a draft, a post waiting for approval, or a scheduled post before it starts sending. Posts already sent cannot be cancelled.",
    method: "POST",
    path: "/v1/posts/{post_id}/cancel",
    input: { properties: { post_id: id("post") }, required: ["post_id"] },
    destructive: true,
    run: (deps, caller, input) => postActions.cancel({ sql: deps.sql }, caller, input),
  },
  {
    name: "delete_post",
    title: "Delete a draft",
    description: "Permanently deletes a draft or a cancelled post. Sent posts are kept for the record.",
    method: "DELETE",
    path: "/v1/posts/{post_id}",
    input: { properties: { post_id: id("post") }, required: ["post_id"] },
    destructive: true,
    run: (deps, caller, input) => postActions.delete({ sql: deps.sql }, caller, input),
  },
  {
    name: "get_usage",
    title: "Usage and plan limits",
    description:
      "Shows usage for a period: posts published (by account and by who made them), posts created by AI, failed publishes, API calls per connection, a day-by-day series, and how close the workspace is to each plan limit.",
    method: "GET",
    path: "/v1/usage",
    input: { properties: { period: { type: "string", enum: [...PERIODS], default: "this_month", description: "Which period, in UTC." } } },
    readOnly: true,
    run: (deps, caller, input) => usageReport(deps.sql, caller, { ...input, workspace_id: caller.workspaceId }),
  },
  {
    name: "list_analytics",
    analytics: true,
    title: "Post stats",
    description:
      "Lists published posts with their stats (views, likes, comments, shares, and saves, reposts or quotes where the platform reports them), plus totals per platform. Sort by any stat to find what performed best.",
    method: "GET",
    path: "/v1/analytics",
    input: {
      properties: {
        platform: { type: "string", enum: PLATFORMS },
        period: { type: "string", enum: [...ANALYTICS_PERIODS], default: "last_30_days", description: "Posts published in this period." },
        sort: { type: "string", enum: ["published_at", "views", "likes", "comments", "shares", "saves", "reposts", "quotes"], default: "published_at" },
        ...paging,
      },
    },
    readOnly: true,
    run: (deps, caller, input) => listAnalytics(deps.sql, caller, deps.analyticsPlatforms, { ...input, workspace_id: caller.workspaceId }),
  },
  {
    name: "get_post_analytics",
    analytics: true,
    title: "One post's stats over time",
    description: "Shows one post's stats on each platform it went to, with a day-by-day history.",
    method: "GET",
    path: "/v1/posts/{post_id}/analytics",
    input: { properties: { post_id: id("post") }, required: ["post_id"] },
    readOnly: true,
    run: (deps, caller, input) => postAnalytics(deps.sql, caller, deps.analyticsPlatforms, input),
  },
  {
    name: "refresh_analytics",
    analytics: true,
    title: "Refresh stats now",
    description: "Fetches fresh stats from the platforms for one post (or all recent posts) instead of waiting for the next automatic update. At most every 30 minutes per post.",
    method: "POST",
    path: "/v1/analytics/refresh",
    input: { properties: { post_id: id("post") } },
    run: (deps, caller, input) => refreshAnalytics(deps.sql, caller, deps.analyticsPlatforms, { ...input, workspace_id: caller.workspaceId }),
  },
  {
    name: "list_post_results",
    title: "Publishing results",
    description: "Shows each account's outcome: published (with the live link), failed (with the platform's reason in plain language), or still in progress. One post's results, or the most recent overall.",
    method: "GET",
    path: "/v1/results",
    input: { properties: { post_id: id("post"), ...paging } },
    readOnly: true,
    run: (deps, caller, input) =>
      listResults(deps.sql, caller, { ...input, workspace_id: caller.workspaceId, post_id: input.post_id === undefined || input.post_id === "" ? undefined : requireUuid(input.post_id, "Post") }),
  },
];

// The operations offered in an environment: stats tools only where stats are switched on.
export function availableOperations(deps: Pick<ApiDeps, "analyticsPlatforms">) {
  return operations.filter((op) => !op.analytics || deps.analyticsPlatforms.length > 0);
}

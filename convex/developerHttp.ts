import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { developerTools } from "./lib/developerTools";
import { publicErrorMessage } from "./lib/publicErrors";

type DeveloperContext = {
  workspaceId: Id<"workspaces">;
  userId: Id<"users">;
};

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, content-type",
      "access-control-allow-methods": "GET, POST, OPTIONS",
    },
  });
}

function safeError(error: unknown) {
  return publicErrorMessage(error);
}

async function authorize(ctx: any, request: Request, requiredScope: string): Promise<DeveloperContext> {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error("AUTH_REQUIRED");
  const keyHash = await sha256(match[1]);
  const access = await ctx.runMutation(internal.apiService.authenticate, { keyHash, requiredScope });
  if (!access) throw new Error("AUTH_INVALID");
  return { workspaceId: access.workspaceId, userId: access.userId };
}

async function listAccountsWithCreatorInfo(ctx: any, access: DeveloperContext) {
  const accounts = await ctx.runQuery(internal.apiService.listAccounts, { workspaceId: access.workspaceId });
  return await Promise.all(accounts.map(async (account: any) => {
    if (account.platform !== "tiktok" || account.health !== "connected") return account;
    try {
      const creatorInfo = await ctx.runAction(internal.platformAccounts.getTikTokCreatorInfoInternal, { workspaceId: access.workspaceId, accountId: account._id });
      return { ...account, creatorInfo };
    } catch (cause) {
      return { ...account, creatorInfoError: safeError(cause) };
    }
  }));
}

async function withApi(request: Request, callback: (ctx: any, access: DeveloperContext) => Promise<unknown>, ctx: any, scope: string) {
  const requestId = crypto.randomUUID();
  try {
    const access = await authorize(ctx, request, scope);
    return json({ data: await callback(ctx, access), request_id: requestId });
  } catch (error) {
    const message = safeError(error);
    const authError = message === "AUTH_REQUIRED" || message === "AUTH_INVALID";
    const rateLimited = message === "API_RATE_LIMITED";
    return json({ error: { code: authError ? "unauthorized" : rateLimited ? "rate_limited" : "invalid_request", message: authError ? "Use a valid Post Social API key." : rateLimited ? "This API key has reached its per-minute request limit." : message }, request_id: requestId }, authError ? 401 : rateLimited ? 429 : 400);
  }
}

export const optionsHandler = httpAction(async () => json({ ok: true }));

export const accountsHandler = httpAction(async (ctx, request) => withApi(request, async (inner, access) => {
  return await listAccountsWithCreatorInfo(inner, access);
}, ctx, "accounts:read"));

export const postsListCreateHandler = httpAction(async (ctx, request) => {
  if (request.method === "GET") {
    return withApi(request, async (inner, access) => {
      const limit = Number(new URL(request.url).searchParams.get("limit") ?? 50);
      return await inner.runQuery(internal.apiService.listPosts, { workspaceId: access.workspaceId, limit });
    }, ctx, "posts:read");
  }
  return withApi(request, async (inner, access) => {
    const body = await request.json();
    return await inner.runMutation(internal.apiService.createDraft, {
      workspaceId: access.workspaceId,
      userId: access.userId,
      caption: body.caption,
      mediaAssetIds: body.media_asset_ids ?? [],
      scheduledAt: body.scheduled_at,
      entryPoint: "api",
      destinations: body.destinations,
    });
  }, ctx, "posts:write");
});

export const postDetailHandler = httpAction(async (ctx, request) => withApi(request, async (inner, access) => {
  const path = new URL(request.url).pathname;
  const postId = decodeURIComponent(path.slice("/api/v1/posts/".length));
  if (!postId || postId.includes("/")) throw new Error("A valid post id is required.");
  const post = await inner.runQuery(internal.apiService.getPost, { workspaceId: access.workspaceId, postId });
  if (!post) throw new Error("Post not found.");
  return post;
}, ctx, "posts:read"));

export const mediaUploadHandler = httpAction(async (ctx, request) => withApi(request, async (inner, access) => {
  const body = await request.json().catch(() => ({}));
  if (!body.storage_id) return await inner.runMutation(internal.apiService.prepareUpload, { workspaceId: access.workspaceId });
  return await inner.runMutation(internal.apiService.finalizeUpload, {
    workspaceId: access.workspaceId,
    userId: access.userId,
    storageId: body.storage_id,
    fileName: body.file_name,
    mimeType: body.mime_type,
    mediaType: body.media_type,
    sizeBytes: body.size_bytes,
    durationSeconds: body.duration_seconds,
    width: body.width,
    height: body.height,
  });
}, ctx, "media:write"));

export const scheduleHandler = httpAction(async (ctx, request) => withApi(request, async (inner, access) => {
  const body = await request.json();
  return await inner.runMutation(internal.apiService.setSchedule, { workspaceId: access.workspaceId, postId: body.post_id, scheduledAt: body.scheduled_at, entryPoint: "api" });
}, ctx, "posts:write"));

export const publishHandler = httpAction(async (ctx, request) => withApi(request, async (inner, access) => {
  const body = await request.json();
  return await inner.runMutation(internal.apiService.requestPublish, { workspaceId: access.workspaceId, userId: access.userId, postId: body.post_id, entryPoint: "api" });
}, ctx, "posts:publish"));

export const cancelHandler = httpAction(async (ctx, request) => withApi(request, async (inner, access) => {
  const body = await request.json();
  return await inner.runMutation(internal.apiService.cancelScheduled, { workspaceId: access.workspaceId, postId: body.post_id, userId: access.userId, entryPoint: "api" });
}, ctx, "posts:write"));

export const mcpHandler = httpAction(async (ctx, request) => {
  const requestId = crypto.randomUUID();
  let rpc: any;
  try { rpc = await request.json(); } catch { return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400); }
  try {
    if (rpc.method === "initialize") {
      await authorize(ctx, request, "accounts:read");
      return json({ jsonrpc: "2.0", id: rpc.id, result: { protocolVersion: "2025-03-26", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "post-social", version: "0.1.0" } } });
    }
    if (rpc.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (rpc.method === "tools/list") {
      await authorize(ctx, request, "accounts:read");
      return json({ jsonrpc: "2.0", id: rpc.id, result: { tools: developerTools } });
    }
    if (rpc.method !== "tools/call") return json({ jsonrpc: "2.0", id: rpc.id, error: { code: -32601, message: "Method not found" } }, 404);
    const name = rpc.params?.name;
    const args = rpc.params?.arguments ?? {};
    const scope = name === "list_accounts" ? "accounts:read" : name === "upload_media" ? "media:write" : ["preview_post", "get_post", "list_posts", "get_post_results"].includes(name) ? "posts:read" : name === "publish_post" ? "posts:publish" : "posts:write";
    const access = await authorize(ctx, request, scope);
    let result: unknown;
    if (name === "list_accounts") result = await listAccountsWithCreatorInfo(ctx, access);
    else if (name === "upload_media") result = args.storage_id
      ? await ctx.runMutation(internal.apiService.finalizeUpload, { workspaceId: access.workspaceId, userId: access.userId, storageId: args.storage_id, fileName: args.file_name, mimeType: args.mime_type, mediaType: args.media_type, sizeBytes: args.size_bytes, durationSeconds: args.duration_seconds, width: args.width, height: args.height })
      : await ctx.runMutation(internal.apiService.prepareUpload, { workspaceId: access.workspaceId });
    else if (name === "create_post_draft") result = await ctx.runMutation(internal.apiService.createDraft, { workspaceId: access.workspaceId, userId: access.userId, caption: args.caption, mediaAssetIds: args.media_asset_ids ?? [], scheduledAt: args.scheduled_at, entryPoint: "mcp", destinations: args.destinations });
    else if (["preview_post", "get_post", "get_post_results"].includes(name)) result = await ctx.runQuery(internal.apiService.getPost, { workspaceId: access.workspaceId, postId: args.post_id });
    else if (name === "list_posts") result = await ctx.runQuery(internal.apiService.listPosts, { workspaceId: access.workspaceId, limit: args.limit ?? 50 });
    else if (name === "schedule_post") result = await ctx.runMutation(internal.apiService.setSchedule, { workspaceId: access.workspaceId, postId: args.post_id, scheduledAt: args.scheduled_at, entryPoint: "mcp" });
    else if (name === "publish_post") result = await ctx.runMutation(internal.apiService.requestPublish, { workspaceId: access.workspaceId, userId: access.userId, postId: args.post_id, entryPoint: "mcp" });
    else if (name === "cancel_scheduled_post") result = await ctx.runMutation(internal.apiService.cancelScheduled, { workspaceId: access.workspaceId, postId: args.post_id, userId: access.userId, entryPoint: "mcp" });
    else return json({ jsonrpc: "2.0", id: rpc.id, error: { code: -32602, message: "Unknown tool" } }, 400);
    return json({ jsonrpc: "2.0", id: rpc.id, result: { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: { data: result }, _meta: { request_id: requestId } } });
  } catch (error) {
    const message = safeError(error);
    const authError = message === "AUTH_REQUIRED" || message === "AUTH_INVALID";
    const rateLimited = message === "API_RATE_LIMITED";
    return json({ jsonrpc: "2.0", id: rpc.id ?? null, error: { code: authError ? -32001 : rateLimited ? -32029 : -32602, message: authError ? "Use a valid Post Social API key." : rateLimited ? "This API key has reached its per-minute request limit." : message, data: { request_id: requestId } } }, authError ? 401 : rateLimited ? 429 : 400);
  }
});

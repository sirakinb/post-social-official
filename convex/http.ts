import { httpRouter } from "convex/server";
import { authComponent, createAuth } from "./auth";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  accountsHandler,
  cancelHandler,
  mediaUploadHandler,
  mcpHandler,
  optionsHandler,
  postDetailHandler,
  postsListCreateHandler,
  publishHandler,
  scheduleHandler,
} from "./developerHttp";
import { metaDataDeletionHandler, metaDataDeletionStatusHandler, metaDeauthorizeHandler } from "./metaDeletionHttp";
import { publicErrorMessage } from "./lib/publicErrors";

const http = httpRouter();
authComponent.registerRoutes(http, createAuth);

function oauthCallback(provider: "tiktok" | "instagram" | "facebook" | "threads" | "youtube") {
  return httpAction(async (ctx, request) => {
    const url = new URL(request.url); const code = url.searchParams.get("code"); const state = url.searchParams.get("state"); const site = process.env.SITE_URL!;
    if (!code || !state) return Response.redirect(`${site}/app/accounts?error=${encodeURIComponent(url.searchParams.get("error_description") ?? "Connection was cancelled.")}`);
    try {
      if (provider === "tiktok") {
        await ctx.runAction(internal.oauth.completeTikTok, { code, state });
      } else if (provider === "instagram") {
        await ctx.runAction(internal.oauth.completeInstagram, { code, state });
      } else if (provider === "threads") {
        await ctx.runAction(internal.oauth.completeThreads, { code, state });
      } else if (provider === "youtube") {
        await ctx.runAction(internal.oauth.completeYouTube, { code, state });
      } else {
        await ctx.runAction(internal.oauth.completeFacebook, { code, state });
      }
      return Response.redirect(`${site}/app/accounts?connected=${provider}`);
    } catch (error) {
      const message = publicErrorMessage(error, "The account could not be connected.");
      return Response.redirect(`${site}/app/accounts?error=${encodeURIComponent(message)}`);
    }
  });
}

http.route({ path: "/api/oauth/tiktok/callback", method: "GET", handler: oauthCallback("tiktok") });
http.route({ path: "/api/oauth/instagram/callback", method: "GET", handler: oauthCallback("instagram") });
http.route({ path: "/api/oauth/facebook/callback", method: "GET", handler: oauthCallback("facebook") });
http.route({ path: "/api/oauth/threads/callback", method: "GET", handler: oauthCallback("threads") });
http.route({ path: "/api/oauth/youtube/callback", method: "GET", handler: oauthCallback("youtube") });

http.route({ path: "/api/v1/accounts", method: "GET", handler: accountsHandler });
http.route({ path: "/api/v1/posts", method: "GET", handler: postsListCreateHandler });
http.route({ path: "/api/v1/posts", method: "POST", handler: postsListCreateHandler });
http.route({ pathPrefix: "/api/v1/posts/", method: "GET", handler: postDetailHandler });
http.route({ path: "/api/v1/media/upload", method: "POST", handler: mediaUploadHandler });
http.route({ path: "/api/v1/schedule", method: "POST", handler: scheduleHandler });
http.route({ path: "/api/v1/publish", method: "POST", handler: publishHandler });
http.route({ path: "/api/v1/cancel", method: "POST", handler: cancelHandler });
http.route({ pathPrefix: "/api/v1/", method: "OPTIONS", handler: optionsHandler });
http.route({ path: "/mcp", method: "POST", handler: mcpHandler });
http.route({ path: "/api/meta/data-deletion", method: "POST", handler: metaDataDeletionHandler });
http.route({ path: "/api/meta/data-deletion/status", method: "GET", handler: metaDataDeletionStatusHandler });
http.route({ path: "/api/meta/deauthorize", method: "POST", handler: metaDeauthorizeHandler });

export default http;

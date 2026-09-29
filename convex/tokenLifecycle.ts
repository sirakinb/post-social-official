"use node";

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { refreshAccessToken as refreshYouTubeAccessToken } from "./lib/youtubeService";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

async function jsonOrThrow(response: Response) {
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(payload.error?.message ?? `Token refresh failed (${response.status}).`);
  return payload;
}

export const refreshExpiring = internalAction({
  args: {},
  handler: async (ctx) => {
    const credentials = await ctx.runQuery(internal.credentials.expiringBefore, {
      before: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });
    for (const record of credentials) {
      const account = await ctx.runQuery(internal.credentials.accountForCredential, { credentialId: record._id });
      if (!account || account.health === "disconnected") continue;
      try {
        const current = await ctx.runAction(internal.credentialVault.decrypt, { credentialId: record._id });
        if (record.platform === "tiktok") {
          if (!current.refreshToken) throw new Error("TikTok refresh token is missing.");
          const body = new URLSearchParams({
            client_key: required("TIKTOK_CLIENT_KEY"),
            client_secret: required("TIKTOK_CLIENT_SECRET"),
            grant_type: "refresh_token",
            refresh_token: current.refreshToken,
          });
          const token = await jsonOrThrow(await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body,
          }));
          await ctx.runAction(internal.credentialVault.encryptAndStore, {
            credentialId: record._id,
            workspaceId: record.workspaceId,
            platform: "tiktok",
            accessToken: token.access_token,
            refreshToken: token.refresh_token ?? current.refreshToken,
            accessTokenExpiresAt: Date.now() + Number(token.expires_in) * 1000,
            refreshTokenExpiresAt: token.refresh_expires_in ? Date.now() + Number(token.refresh_expires_in) * 1000 : record.refreshTokenExpiresAt,
          });
        } else if (record.platform === "instagram") {
          const url = new URL("https://graph.instagram.com/refresh_access_token");
          url.searchParams.set("grant_type", "ig_refresh_token");
          url.searchParams.set("access_token", current.accessToken);
          const token = await jsonOrThrow(await fetch(url));
          await ctx.runAction(internal.credentialVault.encryptAndStore, {
            credentialId: record._id,
            workspaceId: record.workspaceId,
            platform: "instagram",
            accessToken: token.access_token,
            accessTokenExpiresAt: Date.now() + Number(token.expires_in) * 1000,
          });
        } else if (record.platform === "youtube") {
          if (!current.refreshToken) throw new Error("YouTube refresh token is missing.");
          const refreshed = await refreshYouTubeAccessToken(current.refreshToken);
          await ctx.runAction(internal.credentialVault.encryptAndStore, {
            credentialId: record._id,
            workspaceId: record.workspaceId,
            platform: "youtube",
            accessToken: refreshed.accessToken,
            refreshToken: current.refreshToken,
            accessTokenExpiresAt: refreshed.expiresAt.getTime(),
          });
        } else if (record.platform === "threads") {
          const url = new URL("https://graph.threads.net/refresh_access_token");
          url.searchParams.set("grant_type", "th_refresh_token");
          url.searchParams.set("access_token", current.accessToken);
          const token = await jsonOrThrow(await fetch(url));
          await ctx.runAction(internal.credentialVault.encryptAndStore, {
            credentialId: record._id,
            workspaceId: record.workspaceId,
            platform: "threads",
            accessToken: token.access_token,
            accessTokenExpiresAt: Date.now() + Number(token.expires_in) * 1000,
          });
        }
      } catch {
        await ctx.runMutation(internal.credentials.markRefreshFailed, {
          credentialId: record._id,
          reason: "Publishing access expired. Reconnect this account to continue.",
        });
      }
    }
  },
});

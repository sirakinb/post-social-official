// TikTok's latest settings for a creator, read when the composer opens (TikTok's content
// sharing guidelines require it): their nickname, which audiences they can post to, which
// interactions they turned off, and the longest video they can post.
import { ApiError, membership, requireUuid, type Caller, type Sql } from "../access";
import type { Settings } from "./platforms";
import { accountToken } from "../../../worker/src/credentials";

export type CreatorInfo = {
  nickname: string;
  username: string;
  avatar_url: string | null;
  privacy_level_options: string[];
  comment_disabled: boolean;
  duet_disabled: boolean;
  stitch_disabled: boolean;
  max_video_post_duration_sec: number | null;
  can_post: boolean;
};

export async function tiktokCreatorInfo(
  deps: { sql: Sql; setting: Settings; http?: typeof fetch },
  caller: Caller,
  input: { account_id?: unknown },
): Promise<CreatorInfo> {
  const accountId = requireUuid(input.account_id, "Account");
  const [account] = await deps.sql<{ id: string; workspace_id: string; platform: string; display_name: string; health: string }>(
    `SELECT id, workspace_id, platform, display_name, health FROM public.connected_accounts WHERE id = $1`,
    [accountId],
  );
  if (!account || account.platform !== "tiktok") throw new ApiError(404, "That TikTok account was not found.");
  await membership(deps.sql, caller, account.workspace_id, false).catch((error) => {
    if (error instanceof ApiError && error.status === 404) throw new ApiError(404, "That TikTok account was not found.");
    throw error;
  });
  if (account.health === "disconnected") throw new ApiError(409, `${account.display_name} is disconnected. Reconnect it first.`);

  const token = await accountToken(deps, { id: account.id, platform: "tiktok", displayName: account.display_name });
  const response = await (deps.http ?? fetch)("https://open.tiktokapis.com/v2/post/publish/creator_info/query/", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
  });
  const body = (await response.json().catch(() => ({}))) as { data?: Record<string, unknown>; error?: { code?: string; message?: string } };
  if (!response.ok || (body.error && body.error.code !== "ok")) {
    throw new ApiError(502, "TikTok didn't return this account's settings. Try again in a moment.");
  }
  const d = body.data ?? {};
  return {
    nickname: String(d.creator_nickname ?? d.creator_username ?? account.display_name),
    username: String(d.creator_username ?? ""),
    avatar_url: typeof d.creator_avatar_url === "string" ? d.creator_avatar_url : null,
    privacy_level_options: Array.isArray(d.privacy_level_options) ? (d.privacy_level_options as string[]) : [],
    comment_disabled: d.comment_disabled === true,
    duet_disabled: d.duet_disabled === true,
    stitch_disabled: d.stitch_disabled === true,
    max_video_post_duration_sec: Number(d.max_video_post_duration_sec) || null,
    can_post: d.can_post !== false,
  };
}

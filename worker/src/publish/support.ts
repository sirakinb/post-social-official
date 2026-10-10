// Which publishing failures the person can fix themselves (reconnect, change the post, wait
// for a platform limit, check the platform) and which need us. The ones that need us get a
// line pointing to support when the post finally fails.
import { SUPPORT_EMAIL, withSupport } from "../../../backend/lib/support";
import type { PublishError } from "./types";

const PERSON_CAN_FIX = new Set([
  // The post or the account needs a change.
  "invalid",
  "account_disconnected",
  "image_too_large",
  "tiktok_privacy_unavailable",
  "tiktok_video_too_long",
  "tiktok_comments_off",
  "tiktok_duet_off",
  "tiktok_stitch_off",
  "unaudited_client_can_only_post_to_private_accounts",
  "privacy_level_option_mismatch",
  "spam_risk_too_many_pending_share",
  "spam_risk_user_banned_from_posting",
  // A limit on the person's own account; trying later works.
  "rate_limited",
  "x_rate_limited",
  "linkedin_rate_limited",
  "bluesky_rate_limited",
  "bluesky_video_limit",
  "youtube_quota",
  "tiktok_cannot_post",
  "spam_risk_too_many_posts",
  // Maybe posted: the person checks the platform before posting again.
  "unconfirmed",
]);

export function personCanFix(error: PublishError) {
  return error.reconnect || PERSON_CAN_FIX.has(error.code) || PERSON_CAN_FIX.has(error.code.replace(/^tiktok_/, ""));
}

// The message saved and shown for a post that finally failed.
export function failureMessage(error: PublishError) {
  if (personCanFix(error)) return error.message;
  if (error.code === "unexpected") {
    return `Something went wrong on Post Social's side while publishing (${error.message.slice(0, 200)}). Contact support at ${SUPPORT_EMAIL} and we'll get it posted.`;
  }
  return withSupport(error.message, `This isn't something you can fix from your side. Contact support at ${SUPPORT_EMAIL} and we'll look into it.`);
}

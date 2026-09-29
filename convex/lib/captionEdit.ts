import type { ApprovalPolicy } from "./postState";

export const MAX_CAPTION_LENGTH = 10_000;
export const TIKTOK_CAPTION_LIMIT = 2_200;
export const INSTAGRAM_CAPTION_LIMIT = 2_200;

/** Statuses where the caption can still change before anything has been sent. */
export const CAPTION_EDITABLE_STATUSES = ["draft", "awaiting_approval", "approved", "scheduled"] as const;

export function isCaptionEditable(status: string) {
  return (CAPTION_EDITABLE_STATUSES as readonly string[]).includes(status);
}

export type CaptionEditPlan =
  | { kind: "in_place" }
  | { kind: "reapproval" }
  | { kind: "blocked"; reason: string };

/**
 * Decides how a caption edit is applied. An edit to something a human already approved
 * sends it back for approval, because the approval was for the old wording.
 */
export function planCaptionEdit(args: { status: string; policy: ApprovalPolicy; sending: boolean }): CaptionEditPlan {
  if (args.sending || args.status === "processing") {
    return { kind: "blocked", reason: "This post is being sent right now, so its caption can't be changed." };
  }
  if (args.status === "draft" || args.status === "awaiting_approval") return { kind: "in_place" };
  if (args.status === "approved" || args.status === "scheduled") {
    return args.policy === "autonomous" ? { kind: "in_place" } : { kind: "reapproval" };
  }
  if (args.status === "published" || args.status === "partially_published") {
    return { kind: "blocked", reason: "Published posts can't be edited here." };
  }
  return { kind: "blocked", reason: "Only drafts and scheduled posts can be edited. Create a new post instead." };
}

type DestinationLike = { options: { kind: string; caption?: string } };

/** The longest caption every destination will accept. */
export function captionLimit(destinations: DestinationLike[]): number {
  let limit = MAX_CAPTION_LENGTH;
  if (destinations.some((d) => d.options.kind === "tiktok")) limit = Math.min(limit, TIKTOK_CAPTION_LIMIT);
  if (destinations.some((d) => d.options.kind === "instagram" && !d.options.caption)) limit = Math.min(limit, INSTAGRAM_CAPTION_LIMIT);
  return limit;
}

/** Problems that would make the new caption fail at publish time. Empty means fine. */
export function captionProblems(caption: string, destinations: DestinationLike[]): string[] {
  const problems: string[] = [];
  if (!caption.trim()) problems.push("Add a caption before saving.");
  if (caption.length > MAX_CAPTION_LENGTH) problems.push(`Shorten the caption to ${MAX_CAPTION_LENGTH.toLocaleString("en-US")} characters or fewer.`);
  if (destinations.some((d) => d.options.kind === "tiktok") && caption.length > TIKTOK_CAPTION_LIMIT) {
    problems.push("Shorten the TikTok caption to 2,200 characters or fewer.");
  }
  if (destinations.some((d) => d.options.kind === "instagram" && !d.options.caption) && caption.length > INSTAGRAM_CAPTION_LIMIT) {
    problems.push("Shorten the Instagram caption to 2,200 characters or fewer.");
  }
  return problems;
}

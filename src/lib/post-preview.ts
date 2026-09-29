import type { Doc } from "../../convex/_generated/dataModel";

type DestinationOptions = Doc<"destinations">["options"];
type ThreadsDestinationOptions = { kind: "threads"; mediaType: "text" | "image"; text?: string };
export type ExtendedDestinationOptions = DestinationOptions | ThreadsDestinationOptions;

export function isTikTokDraft(options: ExtendedDestinationOptions | undefined) {
  return options?.kind === "tiktok" && options.deliveryMode === "inbox";
}

/** One plain-language line describing the settings a destination will publish with. */
export function destinationProof(options: ExtendedDestinationOptions | undefined) {
  if (!options) return undefined;
  if (options.kind === "tiktok") {
    if (options.deliveryMode === "inbox") return "Draft in your TikTok inbox · open TikTok to add the caption and post";
    const privacy = options.privacyLevel.toLowerCase().replaceAll("_", " ");
    const interactions = [options.commentEnabled ? "Comments on" : "Comments off", options.duetEnabled ? "Duet on" : "Duet off", options.stitchEnabled ? "Stitch on" : "Stitch off"];
    const disclosure = options.disclosureEnabled
      ? [options.yourBrandEnabled ? "Your brand" : "", options.brandedContentEnabled ? "Branded content" : "", options.aiGenerated ? "AI-generated" : ""].filter(Boolean).join(", ") || "Disclosure enabled"
      : "No content disclosure";
    return `${privacy} · ${interactions.join(" · ")} · ${disclosure}`;
  }
  if (options.kind === "instagram") return `${options.mediaType === "reel" ? "Reel" : options.mediaType === "carousel" ? "Carousel" : "Image"} · ${options.caption ? "Custom Instagram caption" : "Shared caption"}`;
  if (options.kind === "threads") return options.mediaType === "image" ? "Image post" : "Text post";
  if (options.kind === "youtube") return `Short · ${options.privacyStatus} · ${options.description ? "Custom YouTube description" : "Shared caption"}`;
  return `${options.mediaType === "feed" ? "Text feed post" : "Image post"} · ${options.message ? "Custom Facebook message" : "Shared caption"}`;
}

/** The exact text a channel will publish. Channel-specific wording wins over the shared caption. */
export function channelText(options: ExtendedDestinationOptions | undefined, sharedCaption: string): { label: string; text: string } | undefined {
  if (!options) return undefined;
  if (options.kind === "tiktok") {
    if (options.deliveryMode === "inbox") return { label: "Caption to paste in TikTok", text: sharedCaption };
    return { label: "TikTok caption", text: sharedCaption };
  }
  if (options.kind === "instagram") return { label: options.caption ? "Instagram caption" : "Instagram caption (shared)", text: options.caption || sharedCaption };
  if (options.kind === "threads") return { label: options.text ? "Threads text" : "Threads text (shared)", text: options.text || sharedCaption };
  if (options.kind === "youtube") return { label: "YouTube title", text: options.title };
  return { label: options.message ? "Facebook message" : "Facebook message (shared)", text: options.message || sharedCaption };
}

export function formatScheduleTime(ms: number) {
  return new Date(ms).toLocaleString([], { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
}

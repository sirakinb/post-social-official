export const POST_STATUS_GROUPS = ["all", "upcoming", "published", "attention", "drafts"] as const;
export type PostStatusGroup = (typeof POST_STATUS_GROUPS)[number];

const groupStatuses: Record<Exclude<PostStatusGroup, "all">, readonly string[]> = {
  upcoming: ["awaiting_approval", "approved", "scheduled", "processing"],
  published: ["published"],
  attention: ["failed", "partially_published"],
  drafts: ["draft", "cancelled"],
};

/** The post statuses a history filter covers, or undefined when it should not filter at all. */
export function statusesForGroup(group: PostStatusGroup | undefined): readonly string[] | undefined {
  if (!group || group === "all") return undefined;
  return groupStatuses[group];
}

import type { PostStatusGroup } from "../../convex/lib/postFilters";

export const STATUS_GROUP_OPTIONS: { value: PostStatusGroup; label: string }[] = [
  { value: "all", label: "All" },
  { value: "upcoming", label: "Upcoming" },
  { value: "published", label: "Published" },
  { value: "attention", label: "Needs attention" },
  { value: "drafts", label: "Drafts" },
];

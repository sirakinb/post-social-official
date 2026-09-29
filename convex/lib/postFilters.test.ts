import { describe, expect, it } from "vitest";
import { POST_STATUS_GROUPS, statusesForGroup } from "./postFilters";

describe("post history filters", () => {
  it("does not filter for all or an unset group", () => {
    expect(statusesForGroup("all")).toBeUndefined();
    expect(statusesForGroup(undefined)).toBeUndefined();
  });

  it("maps each group to the statuses it should show", () => {
    expect(statusesForGroup("upcoming")).toEqual(["awaiting_approval", "approved", "scheduled", "processing"]);
    expect(statusesForGroup("published")).toEqual(["published"]);
    expect(statusesForGroup("attention")).toEqual(["failed", "partially_published"]);
    expect(statusesForGroup("drafts")).toEqual(["draft", "cancelled"]);
  });

  it("covers every post status exactly once so no post is hidden by the filters", () => {
    const all = ["draft", "awaiting_approval", "approved", "scheduled", "processing", "published", "partially_published", "failed", "cancelled"];
    const covered = POST_STATUS_GROUPS.flatMap((group) => statusesForGroup(group) ?? []);
    expect([...covered].sort()).toEqual([...all].sort());
  });
});

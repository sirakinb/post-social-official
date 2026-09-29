import { describe, expect, it } from "vitest";
import { mediaRemovalPlan } from "./mediaRemoval";

describe("mediaRemovalPlan", () => {
  it("permanently deletes media with no post references", () => {
    expect(mediaRemovalPlan(0)).toEqual({
      action: "delete",
      preservedPostReferences: 0,
    });
  });

  it("hides referenced media while preserving its post references", () => {
    expect(mediaRemovalPlan(2)).toEqual({
      action: "hide",
      preservedPostReferences: 2,
    });
  });
});

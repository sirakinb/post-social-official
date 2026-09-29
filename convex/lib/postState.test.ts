import { describe, expect, it } from "vitest";
import {
  assertPostTransition,
  stateAfterApproval,
  stateAfterPublishRequest,
  strictestPolicy,
} from "./postState";

describe("post publishing state machine", () => {
  it("requires human approval for both human-review policies", () => {
    expect(stateAfterPublishRequest("confirm_each")).toBe("awaiting_approval");
    expect(stateAfterPublishRequest("approve_after_draft")).toBe("awaiting_approval");
  });

  it("allows autonomous policy to proceed without a review decision", () => {
    expect(stateAfterPublishRequest("autonomous")).toBe("approved");
  });

  it("moves an approved future post to scheduled", () => {
    expect(stateAfterApproval(2_000, 1_000)).toBe("scheduled");
  });

  it("rejects impossible transitions", () => {
    expect(() => assertPostTransition("draft", "published")).toThrow(/Invalid post transition/);
  });

  it("lets an approved or scheduled post return for approval after a caption edit, but nothing that was sent", () => {
    expect(() => assertPostTransition("scheduled", "awaiting_approval")).not.toThrow();
    expect(() => assertPostTransition("approved", "awaiting_approval")).not.toThrow();
    expect(() => assertPostTransition("processing", "awaiting_approval")).toThrow(/Invalid post transition/);
    expect(() => assertPostTransition("published", "awaiting_approval")).toThrow(/Invalid post transition/);
  });

  it("uses the safest policy when selected accounts differ", () => {
    expect(strictestPolicy(["autonomous", "confirm_each", "approve_after_draft"])).toBe("confirm_each");
  });
});

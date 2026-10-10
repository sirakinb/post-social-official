import { describe, expect, it } from "vitest";
import { OUR_SIDE, SUPPORT_EMAIL, requestError, withSupport } from "./support";

describe("support wording", () => {
  it("adds the support line once, with a full stop before it", () => {
    expect(withSupport("It failed")).toBe(`It failed. If it keeps happening, contact support at ${SUPPORT_EMAIL}.`);
    expect(withSupport(withSupport("It failed."))).toBe(withSupport("It failed."));
  });

  it("shows a 4xx message as is and sends a 5xx to support", () => {
    expect(requestError(400, "That name is taken.")).toBe("That name is taken.");
    expect(requestError(409, null)).toBe(OUR_SIDE);
    expect(requestError(500, null)).toBe(OUR_SIDE);
    expect(requestError(502, "TikTok did not answer.")).toContain(`contact support at ${SUPPORT_EMAIL}`);
  });
});

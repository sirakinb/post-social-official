import { describe, expect, it } from "vitest";
import { publicErrorMessage } from "./publicErrors";

describe("publicErrorMessage", () => {
  it("removes Convex stack details from user-visible errors", () => {
    expect(publicErrorMessage(new Error("Uncaught Error: No Pages were available.\n    at handler (../convex/oauth.ts:10:2)"))).toBe("No Pages were available.");
  });

  it("redacts token-shaped values", () => {
    expect(publicErrorMessage(new Error("access_token=secret-value was rejected"))).not.toContain("secret-value");
  });
});

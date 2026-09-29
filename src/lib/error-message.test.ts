import { describe, expect, it } from "vitest";
import { friendlyErrorMessage } from "./error-message";

describe("friendlyErrorMessage", () => {
  it("removes backend stack and source details", () => {
    expect(
      friendlyErrorMessage(
        new Error("Uncaught Error: No pages available at handler (../convex/oauth.ts:203:57)\nstack"),
        "Fallback",
      ),
    ).toBe("No pages available");
  });

  it("redacts keys and token-shaped values", () => {
    expect(
      friendlyErrorMessage(
        "access_token=secret123 refresh_token: 'secret456' client_secret=abc ps_live_abcdef",
        "Fallback",
      ),
    ).toBe(
      "access_token=[redacted] refresh_token=[redacted] client_secret=[redacted] [redacted]",
    );
  });

  it("uses the fallback for empty or fully redacted messages", () => {
    expect(friendlyErrorMessage(undefined, "Fallback")).toBe("Fallback");
    expect(friendlyErrorMessage(new Error("ps_live_abcdef"), "Fallback")).toBe("Fallback");
  });
});

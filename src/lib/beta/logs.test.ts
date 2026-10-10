import { describe, expect, it } from "vitest";
import { areaOf, errorOf, levelOf } from "./logs";

describe("logs", () => {
  it("sorts events into levels and areas", () => {
    expect(levelOf("destination.failed")).toBe("error");
    expect(levelOf("account.deauthorized")).toBe("warning");
    expect(levelOf("post.created")).toBe("info");
    expect(areaOf("destination.published")).toBe("posts");
    expect(areaOf("profile.created")).toBe("accounts");
    expect(areaOf("oauth_grant.revoked")).toBe("access");
    expect(areaOf("workspace.renamed")).toBeNull();
  });

  it("finds the reason a failure gave, wherever it was written", () => {
    expect(errorOf("destination.failed", { code: "rate_limited", message: "Instagram says slow down" }, null)).toEqual({ code: "rate_limited", message: "Instagram says slow down" });
    expect(errorOf("media.failed", { reason: "Video is longer than 3 minutes" }, null)).toEqual({ code: null, message: "Video is longer than 3 minutes" });
    expect(errorOf("account.refresh_failed", null, null)).toBeNull();
    expect(errorOf("post.created", { message: "not an error" }, null)).toBeNull();
  });
});

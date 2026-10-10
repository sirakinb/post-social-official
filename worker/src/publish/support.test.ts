import { describe, expect, it } from "vitest";
import { SUPPORT_EMAIL } from "../../../backend/lib/support";
import { failureMessage, personCanFix } from "./support";
import { PublishError } from "./types";

describe("failureMessage", () => {
  it("leaves problems the person can fix as they are", () => {
    const reconnect = new PublishError("access_expired", "Reconnect X and try again.", false, undefined, true);
    expect(failureMessage(reconnect)).toBe("Reconnect X and try again.");
    const invalid = new PublishError("invalid", "The caption is too long for X.");
    expect(failureMessage(invalid)).toBe("The caption is too long for X.");
    // TikTok's own codes arrive with and without the tiktok_ prefix.
    expect(personCanFix(new PublishError("tiktok_privacy_level_option_mismatch", "Choose another audience."))).toBe(true);
    expect(personCanFix(new PublishError("spam_risk_too_many_posts", "Try again tomorrow."))).toBe(true);
  });

  it("points everything else to support", () => {
    for (const error of [
      new PublishError("http_500", "Posting to LinkedIn failed (500)."),
      new PublishError("x_forbidden", "Posting was refused by X"),
      new PublishError("media_unavailable", "The stored media could not be read.", true),
      new PublishError("url_ownership_unverified", "TikTok couldn't fetch the photos."),
    ]) {
      const message = failureMessage(error);
      expect(message.startsWith(error.message.replace(/\.$/, ""))).toBe(true);
      expect(message).toContain(`Contact support at ${SUPPORT_EMAIL}`);
    }
  });

  it("says a crash is on our side and adds support once", () => {
    expect(failureMessage(new PublishError("unexpected", "fetch failed", true))).toMatch(/^Something went wrong on Post Social's side while publishing \(fetch failed\)\. Contact support/);
    const credits = new PublishError("x_no_credits", `X posting is unavailable. Contact support at ${SUPPORT_EMAIL} and we'll get it posted.`);
    expect(failureMessage(credits)).toBe(credits.message);
  });
});

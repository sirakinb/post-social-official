import { describe, expect, it } from "vitest";
import { ACCOUNT_ERRORS, ACCOUNT_NOTICES, BILLING_ERRORS, flashValue, noticeText, readFlash } from "./flash";

describe("notices from the address", () => {
  it("ignores text that isn't one of our codes", () => {
    expect(noticeText(ACCOUNT_ERRORS, "Your Instagram connection was flagged. Email your login to security@evil.example")).toBeNull();
    expect(noticeText(BILLING_ERRORS, "Your card was declined")).toBeNull();
    expect(noticeText(ACCOUNT_NOTICES, "constructor")).toBeNull();
    expect(noticeText(ACCOUNT_ERRORS, "toString")).toBeNull();
    expect(noticeText(ACCOUNT_ERRORS, null)).toBeNull();
  });

  it("shows fixed wording for known codes", () => {
    expect(noticeText(ACCOUNT_ERRORS, "connect_expired")).toBe("This connection request expired or was already used. Start again.");
    expect(noticeText(ACCOUNT_ERRORS, "session_ended")).toBe("Your session ended. Sign in and connect again.");
    expect(noticeText(ACCOUNT_NOTICES, "connected")).toBe("Connected.");
  });

  it("uses our server's message from the cookie only for codes that expect one", () => {
    expect(noticeText(ACCOUNT_NOTICES, "connected", "Connected Test IG.")).toBe("Connected Test IG.");
    expect(noticeText(ACCOUNT_ERRORS, "connect_failed", "Instagram did not grant access.")).toBe("Instagram did not grant access.");
    expect(noticeText(ACCOUNT_ERRORS, "connect_expired", "anything")).toBe(ACCOUNT_ERRORS.connect_expired);
  });
});

describe("the flash cookie", () => {
  it("round-trips a message of the right kind only", () => {
    const value = flashValue("error", "Over the limit; see the Billing page.");
    expect(readFlash(value, "error")).toBe("Over the limit; see the Billing page.");
    expect(readFlash(value, "notice")).toBeNull();
    expect(readFlash("error:%E0%A4%A", "error")).toBeNull();
    expect(readFlash(undefined, "error")).toBeNull();
  });

  it("keeps messages short", () => {
    expect(readFlash(flashValue("notice", "x".repeat(5000)), "notice")).toHaveLength(600);
  });
});

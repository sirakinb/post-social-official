import { describe, expect, it } from "vitest";
import { appMark } from "@/components/beta/marks";
import { lowerFirst, statusFor } from "./home";

describe("activity sentences", () => {
  it("reads naturally after the actor's name", () => {
    expect(lowerFirst("Created a draft for Pentridge Media")).toBe("created a draft for Pentridge Media");
    expect(lowerFirst("API key created")).toBe("API key created");
  });

  it("shows a status only where it helps", () => {
    expect(statusFor("destination.published", "Published to Aki")).toEqual({ label: "Live", tone: "live" });
    expect(statusFor("destination.failed", "Failed")).toEqual({ label: "Failed", tone: "failed" });
    expect(statusFor("post.submitted", "Scheduled for 2026-10-06T13:00:00Z")).toEqual({ label: "Scheduled", tone: "scheduled" });
    expect(statusFor("post.submitted", "Sent for publishing now")).toEqual({ label: "Publishing", tone: "scheduled" });
    expect(statusFor("api_key.created", "Created live API key")).toBeNull();
  });

  it("recognizes AI apps by the name they signed in with", () => {
    expect(appMark("Claude Code (post-social-oauth)")).toBe("claude");
    expect(appMark("ChatGPT")).toBe("openai");
    expect(appMark("Cursor")).toBeNull();
  });
});

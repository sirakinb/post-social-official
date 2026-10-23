import { describe, expect, it } from "vitest";
import { trackedPath } from "./analytics";

describe("trackedPath", () => {
  it("tracks the public site and the sign-in and sign-up pages", () => {
    for (const path of ["/", "/pricing", "/docs", "/docs/quickstart", "/changelog", "/privacy", "/terms", "/beta/login", "/beta/signup", "/beta/login/"]) expect(trackedPath(path)).toBe(true);
  });
  it("skips the signed-in app and the AI approval screens", () => {
    for (const path of ["/beta", "/beta/accounts", "/beta/create", "/beta/billing", "/beta/reset-password", "/beta/authorize", "/oauth/authorize", "/oauth/youtube/callback", "/tiktok-media/abc"]) expect(trackedPath(path)).toBe(false);
  });
});

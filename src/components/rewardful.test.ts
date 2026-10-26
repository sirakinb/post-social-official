import { describe, expect, it } from "vitest";
import { rewardfulPath } from "./rewardful";

describe("rewardfulPath", () => {
  it("runs on the public site, sign-in, sign-up and the billing page", () => {
    for (const path of ["/", "/pricing", "/affiliates", "/docs", "/terms", "/beta/login", "/beta/signup", "/beta/billing", "/beta/billing/"]) expect(rewardfulPath(path)).toBe(true);
  });
  it("stays out of the rest of the signed-in app and the AI approval screens", () => {
    for (const path of ["/beta", "/beta/accounts", "/beta/create", "/beta/authorize", "/oauth/authorize", "/tiktok-media/abc", "/beta/billing/other"]) expect(rewardfulPath(path)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { cleanUrl } from "./clean-url";

describe("cleanUrl", () => {
  it("removes codes, return paths and messages, keeps the page", () => {
    const cleaned = cleanUrl("https://www.postsocial.xyz/beta/login?next=%2Fbeta%2Fconnect%2Ffinish%3Fcode%3Dabc&utm_source=x");
    expect(cleaned).toBe("https://www.postsocial.xyz/beta/login?next=%5Bremoved%5D&utm_source=x");
    expect(cleanUrl("https://www.postsocial.xyz/beta/accounts?connected=instagram&message=Connected+Maya")).not.toMatch(/Maya|instagram/);
    expect(cleanUrl("/beta/accounts?error=Nope")).toBe("/beta/accounts?error=%5Bremoved%5D");
    expect(cleanUrl("https://www.postsocial.xyz/")).toBe("https://www.postsocial.xyz/");
  });
});

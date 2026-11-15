// @vitest-environment node
import { describe, expect, it } from "vitest";
import { tiktokMediaSource } from "./tiktok-media";

describe("tiktokMediaSource pinned to our own storage", () => {
  const ours = "0123456789abcdef0123456789abcdef";
  const foreign = "fedcba9876543210fedcba9876543210";
  const ws = "11111111-2222-4333-8444-555555555555";
  const media = "66666666-7777-4888-9999-000000000000";
  const env = { R2_ACCOUNT_ID: ours, R2_BUCKET: "postsocial-media-prod", R2_ACCESS_KEY_ID: "AKOURS" };
  const link = (account: string, bucket = "postsocial-media-prod", key = "AKOURS") =>
    `https://${account}.r2.cloudflarestorage.com/${bucket}/workspaces/${ws}/media/${media}/tiktok.jpg?X-Amz-Credential=${key}%2F20261027%2Fauto%2Fs3%2Faws4_request&X-Amz-Expires=7200&X-Amz-Signature=abc`;
  const file = (url: string) => `${Buffer.from(url).toString("base64url")}.jpg`;

  it("accepts a link to our account, bucket and key", () => {
    expect(tiktokMediaSource(file(link(ours)), env)).toBe(link(ours));
  });

  it("refuses a look-alike bucket in someone else's R2 account", () => {
    expect(tiktokMediaSource(file(link(foreign)), env)).toBeNull();
    expect(tiktokMediaSource(file(link(ours, "postsocial-media-dev")), env)).toBeNull();
    expect(tiktokMediaSource(file(link(ours, undefined, "AKTHEIRS")), env)).toBeNull();
    expect(tiktokMediaSource(file(link(ours).replace(/X-Amz-Credential=[^&]+&/, "")), env)).toBeNull();
  });

  it("refuses everything when the configured account id is malformed", () => {
    expect(tiktokMediaSource(file(link(ours)), { R2_ACCOUNT_ID: "not-an-id" })).toBeNull();
  });
});

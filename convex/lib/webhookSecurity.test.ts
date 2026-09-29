import { describe, expect, it } from "vitest";
import { createWebhookSignature, isPrivateNetworkAddress, validateWebhookUrl, verifyWebhookSignature } from "./webhookSecurity";

describe("webhook signatures", () => {
  it("signs the exact timestamp and payload", () => {
    const signature = createWebhookSignature("whsec_test", "1721540000", '{"event":"destination.published"}');
    expect(verifyWebhookSignature("whsec_test", "1721540000", '{"event":"destination.published"}', `v1=${signature}`)).toBe(true);
  });

  it("rejects tampered payloads and timestamps", () => {
    const signature = createWebhookSignature("whsec_test", "1721540000", '{"status":"published"}');
    expect(verifyWebhookSignature("whsec_test", "1721540000", '{"status":"failed"}', signature)).toBe(false);
    expect(verifyWebhookSignature("whsec_test", "1721540001", '{"status":"published"}', signature)).toBe(false);
  });

  it("accepts public HTTPS webhooks and rejects local or credential-bearing targets", () => {
    expect(validateWebhookUrl("https://hooks.example.com/post-social").hostname).toBe("hooks.example.com");
    expect(() => validateWebhookUrl("http://hooks.example.com/post-social")).toThrow("HTTPS");
    expect(() => validateWebhookUrl("https://127.0.0.1/post-social")).toThrow("public internet");
    expect(() => validateWebhookUrl("https://10.0.0.2/post-social")).toThrow("public internet");
    expect(() => validateWebhookUrl("https://user:pass@hooks.example.com/post-social")).toThrow("embedded credentials");
  });

  it("recognizes private IPv4, IPv6, and IPv4-mapped IPv6 destinations", () => {
    expect(isPrivateNetworkAddress("127.0.0.1")).toBe(true);
    expect(isPrivateNetworkAddress("169.254.169.254")).toBe(true);
    expect(isPrivateNetworkAddress("10.0.0.4")).toBe(true);
    expect(isPrivateNetworkAddress("::1")).toBe(true);
    expect(isPrivateNetworkAddress("fd00::1")).toBe(true);
    expect(isPrivateNetworkAddress("::ffff:192.168.1.10")).toBe(true);
    expect(isPrivateNetworkAddress("8.8.8.8")).toBe(false);
    expect(isPrivateNetworkAddress("2606:4700:4700::1111")).toBe(false);
  });
});

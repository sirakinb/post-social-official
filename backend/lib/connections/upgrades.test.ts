import { describe, expect, it } from "vitest";
import { NEW_PERMISSIONS_SINCE, reconnectGains } from "./upgrades";

const before = "2026-11-20T10:00:00Z";
const after = "2026-11-21T22:25:00Z";

describe("which accounts a reconnect would upgrade", () => {
  it("Meta accounts that last signed in before the new permissions were switched on", () => {
    for (const platform of ["instagram", "facebook", "threads"]) {
      expect(reconnectGains({ platform, health: "connected", scopes: null, lastConnectedAt: before })).toEqual(["Inbox", "official stats"]);
      expect(reconnectGains({ platform, health: "connected", scopes: null, lastConnectedAt: after })).toBeNull();
    }
    // Not known yet: asking is safer than hiding the Inbox.
    expect(reconnectGains({ platform: "instagram", health: "connected", scopes: null, lastConnectedAt: null })).toEqual(["Inbox", "official stats"]);
    expect(Date.parse(NEW_PERMISSIONS_SINCE)).toBeGreaterThan(Date.parse(before));
  });

  it("TikTok accounts by what they actually granted", () => {
    expect(reconnectGains({ platform: "tiktok", health: "connected", scopes: ["user.info.basic", "video.publish"], lastConnectedAt: after })).toEqual(["video stats"]);
    expect(reconnectGains({ platform: "tiktok", health: "connected", scopes: ["user.info.basic", "video.list"], lastConnectedAt: before })).toBeNull();
  });

  it("never disconnected accounts or platforms with nothing new", () => {
    expect(reconnectGains({ platform: "instagram", health: "disconnected", scopes: null, lastConnectedAt: before })).toBeNull();
    for (const platform of ["x", "bluesky", "youtube", "linkedin"]) expect(reconnectGains({ platform, health: "connected", scopes: null, lastConnectedAt: before })).toBeNull();
  });
});

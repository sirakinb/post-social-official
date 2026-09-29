import { describe, expect, it } from "vitest";
import {
  deduplicateConnectedAccounts,
  type DeduplicatableAccount,
} from "./accountDeduplication";

type TestAccount = DeduplicatableAccount & {
  id: string;
  displayName?: string;
};

function account(overrides: Partial<TestAccount> & Pick<TestAccount, "id">): TestAccount {
  return {
    platform: "instagram",
    externalAccountId: overrides.id,
    handle: "creator",
    health: "connected",
    updatedAt: 1,
    ...overrides,
  };
}

describe("deduplicateConnectedAccounts", () => {
  it("normalizes Instagram handles and prefers a connected record", () => {
    const disconnected = account({
      id: "old",
      externalAccountId: "app-scoped-old",
      handle: "  @@SirAkinB  ",
      health: "disconnected",
      updatedAt: 20,
    });
    const connected = account({
      id: "current",
      externalAccountId: "app-scoped-current",
      handle: "@sirakinb",
      health: "connected",
      updatedAt: 10,
    });

    expect(deduplicateConnectedAccounts([disconnected, connected])).toEqual([connected]);
  });

  it("prefers the newest Threads record when health is equal", () => {
    const older = account({
      id: "older",
      platform: "threads",
      handle: "sirakinb",
      updatedAt: 10,
    });
    const newer = account({
      id: "newer",
      platform: "threads",
      handle: "@SIRAKINB",
      updatedAt: 20,
    });

    expect(deduplicateConnectedAccounts([older, newer])).toEqual([newer]);
  });

  it("keeps the same handle on different platforms separate", () => {
    const instagram = account({ id: "instagram", platform: "instagram" });
    const threads = account({ id: "threads", platform: "threads" });

    expect(deduplicateConnectedAccounts([instagram, threads])).toEqual([
      instagram,
      threads,
    ]);
  });

  it("keeps Facebook Pages with different external IDs separate", () => {
    const firstPage = account({
      id: "first",
      platform: "facebook",
      externalAccountId: "page-1",
      handle: "shared-name",
      displayName: "Shared Page",
    });
    const secondPage = account({
      id: "second",
      platform: "facebook",
      externalAccountId: "page-2",
      handle: "shared-name",
      displayName: "Shared Page",
    });

    expect(deduplicateConnectedAccounts([firstPage, secondPage])).toEqual([
      firstPage,
      secondPage,
    ]);
  });

  it("collapses duplicate Facebook external IDs", () => {
    const disconnected = account({
      id: "old",
      platform: "facebook",
      externalAccountId: "page-1",
      health: "disconnected",
      updatedAt: 20,
    });
    const connected = account({
      id: "current",
      platform: "facebook",
      externalAccountId: "page-1",
      health: "connected",
      updatedAt: 10,
    });

    expect(deduplicateConnectedAccounts([disconnected, connected])).toEqual([connected]);
  });

  it("falls back to external ID when the handle is blank", () => {
    const older = account({
      id: "older",
      externalAccountId: "same-id",
      handle: "  @  ",
      updatedAt: 10,
    });
    const newer = account({
      id: "newer",
      externalAccountId: "same-id",
      handle: undefined,
      updatedAt: 20,
    });

    expect(deduplicateConnectedAccounts([older, newer])).toEqual([newer]);
  });
});

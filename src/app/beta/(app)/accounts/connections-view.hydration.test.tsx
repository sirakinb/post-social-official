import { within } from "@testing-library/react";
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectionsView, type SocialAccount } from "./connections-view";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/beta/accounts" }));
vi.mock("./actions", () => ({ startConnection: vi.fn(), disconnect: vi.fn(), createProfile: vi.fn(), updateProfile: vi.fn(), deleteProfile: vi.fn(), moveAccount: vi.fn(), setTiktokDelivery: vi.fn() }));

// Connected at 9:30 pm in New York: already the next day in UTC, where the server renders.
const account: SocialAccount = { id: "a1", platform: "x", handle: "late", name: "Late", avatarUrl: null, health: "connected", reason: null, postTypes: [], connectedAt: "2026-11-15T02:30:00Z", lastPostedAt: null, profileId: null };
const props = { workspaceId: "w", workspaceSlug: "w", role: "owner", loadError: false, notice: null, error: null, requested: null, connectProfile: null, profilesReady: true, profiles: [], accounts: [account], filter: null };

const zone = process.env.TZ;
afterEach(() => {
  if (zone === undefined) delete process.env.TZ;
  else process.env.TZ = zone;
  document.body.innerHTML = "";
});

describe("Accounts page hydration", () => {
  it("hydrates without a mismatch when the browser's time zone differs from the server's", async () => {
    process.env.TZ = "UTC";
    const html = renderToString(<ConnectionsView {...props} />);
    process.env.TZ = "America/New_York";
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    const errors: unknown[] = [];
    await act(async () => {
      hydrateRoot(container, <ConnectionsView {...props} />, { onRecoverableError: (e) => errors.push(e) });
    });
    expect(errors).toEqual([]);
    // After hydration the browser shows its own relative time, and the list and connect buttons are there.
    expect(container.textContent).toMatch(/Connected \S+/);
    expect(container.textContent).toContain("Late");
    const connect = within(container).getByRole("region", { name: "Connect an account" });
    expect(within(connect).getAllByRole("button").some((b) => b.textContent?.trim() === "Instagram")).toBe(true);
  });
});

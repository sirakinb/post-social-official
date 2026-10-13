import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConnectionsView, type SocialAccount } from "./connections-view";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/beta/accounts" }));
const startConnection = vi.fn(async () => ({ ok: false as const, error: "stop here" }));
vi.mock("./actions", () => ({
  startConnection: (...args: unknown[]) => startConnection(...(args as [])),
  disconnect: vi.fn(),
  createProfile: vi.fn(),
  updateProfile: vi.fn(),
  deleteProfile: vi.fn(),
  moveAccount: vi.fn(),
  setTiktokDelivery: (...args: unknown[]) => setTiktokDelivery(...(args as [])),
}));
const setTiktokDelivery = vi.fn(async () => ({ ok: true as const, data: { tiktok_delivery: "inbox" } }));

const account = (id: string, name: string, profileId: string | null): SocialAccount => ({ id, platform: "x", handle: name.toLowerCase(), name, avatarUrl: null, health: "connected", reason: null, postTypes: [], connectedAt: "2026-10-01T00:00:00Z", lastPostedAt: null, profileId });
const profiles = [
  { id: "p1", name: "Vibe Code Philly", description: "Builders in Philly", color: "#3DD68C", timezone: "America/New_York" },
  { id: "p2", name: "Still Meditation", description: null, color: "#F5B54A", timezone: null },
];
// The profile groups, in order (the Connect section is labelled by its heading instead).
const groupNames = () => screen.getAllByRole("region").map((r) => r.getAttribute("aria-label")).filter(Boolean);
const base = { workspaceId: "w", workspaceSlug: "w", role: "owner", loadError: false, notice: null, error: null, requested: null, connectProfile: null, profilesReady: true, profiles, accounts: [account("a1", "Vibe", "p1"), account("a2", "Still", "p2"), account("a3", "Loose", null)] };

describe("Accounts grouped by profile", () => {
  it("shows every profile as a group, with accounts in no profile last", () => {
    render(<ConnectionsView {...base} filter={null} />);
    expect(groupNames()).toEqual(["Vibe Code Philly", "Still Meditation", "No profile"]);
    expect(within(screen.getByRole("region", { name: "Vibe Code Philly" })).getByText("Vibe")).toBeTruthy();
    expect(screen.getByRole("tab", { name: /All accounts 3/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("filters to one profile and connects new accounts into it", async () => {
    render(<ConnectionsView {...base} filter="p2" />);
    expect(groupNames()).toEqual(["Still Meditation"]);
    expect(screen.queryByText("Vibe")).toBeNull();
    expect((screen.getByLabelText("Add to") as HTMLSelectElement).value).toBe("p2");
    fireEvent.click(within(screen.getByRole("region", { name: "Connect an account" })).getAllByRole("button").find((b) => b.textContent?.trim() === "X")!);
    expect(startConnection).toHaveBeenCalledWith("w", "w", "x", undefined, "p2");
  });

  it("changes the filter through the address bar", () => {
    render(<ConnectionsView {...base} filter={null} />);
    fireEvent.click(screen.getByRole("tab", { name: /No profile/ }));
    expect(replace).toHaveBeenCalledWith(expect.stringContaining("profile=none"), { scroll: false });
  });

  it("hides profile controls before profiles exist in this environment", () => {
    render(<ConnectionsView {...base} profiles={[]} profilesReady={false} filter={null} />);
    expect(screen.queryByRole("button", { name: "+ New profile" })).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByRole("status").textContent).toMatch(/aren.t switched on/);
  });

  it("offers a profile filter and New profile before any profile exists", () => {
    render(<ConnectionsView {...base} profiles={[]} filter={null} />);
    expect(screen.getByRole("tab", { name: /All accounts 3/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "+ New profile" })).toBeTruthy();
  });
});

describe("TikTok AI posts", () => {
  const tiktok = (tiktokDelivery: "direct" | "inbox" | null): SocialAccount => ({ ...account("t1", "Adzo", null), platform: "tiktok", handle: "adzoai", tiktokDelivery });

  it("posts directly by default and switches to inbox first", () => {
    render(<ConnectionsView {...base} accounts={[tiktok("direct")]} filter={null} />);
    const select = screen.getByLabelText("How AI posts reach Adzo") as HTMLSelectElement;
    expect(select.value).toBe("direct");
    fireEvent.change(select, { target: { value: "inbox" } });
    expect(setTiktokDelivery).toHaveBeenCalledWith("t1", "inbox");
  });

  it("hides the setting where it doesn't exist yet, and from reviewers", () => {
    const { unmount } = render(<ConnectionsView {...base} accounts={[tiktok(null)]} filter={null} />);
    expect(screen.queryByLabelText("How AI posts reach Adzo")).toBeNull();
    unmount();
    render(<ConnectionsView {...base} role="reviewer" accounts={[tiktok("direct")]} filter={null} />);
    expect(screen.queryByLabelText("How AI posts reach Adzo")).toBeNull();
  });
});

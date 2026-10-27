import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Composer } from "./composer";

vi.mock("./actions", () => ({
  callPosts: vi.fn(async () => ({ ok: true, data: { ok: true, problems: [] } })),
  getCreatorInfo: vi.fn(async () => ({ ok: false, error: "none" })),
  getMediaLinks: vi.fn(async () => ({})),
}));
vi.mock("@/lib/share-inbox", () => ({ takeShared: vi.fn(async () => null) }));

const account = { id: "a1", platform: "bluesky" as const, name: "Ada", handle: "ada.bsky.social", avatarUrl: null, captionMax: 300, videoMaxSeconds: null };

describe("Composer", () => {
  it("opens without errors and keeps the real button name, showing problems only after a try", async () => {
    render(<Composer workspaceId="w1" accounts={[account]} library={[]} editing={null} />);
    const publish = screen.getByRole("button", { name: "Publish now" });
    expect(publish).toBeEnabled();
    expect(screen.queryByText("Choose at least one account.")).toBeNull();
    expect(screen.queryByText(/Fix \d issue/)).toBeNull();

    await act(async () => fireEvent.click(publish));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose at least one account.");
    expect(screen.getByRole("button", { name: "Publish now" })).toBeInTheDocument();
  });

  it("says Schedule before a time is picked", () => {
    render(<Composer workspaceId="w1" accounts={[account]} library={[]} editing={null} />);
    fireEvent.click(screen.getByRole("radio", { name: "Schedule" }));
    expect(screen.getByRole("button", { name: "Schedule" })).toBeEnabled();
  });

  it("makes connecting an account the main action when there is none", () => {
    render(<Composer workspaceId="w1" accounts={[]} library={[]} editing={null} />);
    expect(screen.getByRole("link", { name: "Connect an account first" })).toHaveAttribute("href", "/beta/accounts");
    expect(screen.queryByRole("button", { name: "Publish now" })).toBeNull();
    expect(screen.queryByText("Choose at least one account.")).toBeNull();
  });
});

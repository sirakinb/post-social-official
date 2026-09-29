import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DestinationRail } from "./destination-rail";
import { ConnectedAccount } from "@/lib/types";

const account: ConnectedAccount = {
  id: "ig_1",
  platform: "instagram",
  handle: "studio",
  displayName: "Studio",
  health: "needs_attention",
  healthReason: "Reconnect Instagram",
};

const threadsAccount: ConnectedAccount = {
  id: "th_1",
  platform: "threads",
  handle: "studio",
  displayName: "Studio",
  health: "connected",
};

describe("DestinationRail", () => {
  it("does not allow an account needing attention to be selected", () => {
    render(<DestinationRail accounts={[account]} selected={[]} onChange={vi.fn()} />);
    expect(screen.getByRole("checkbox", { name: /Publish to Studio/i })).toBeDisabled();
    expect(screen.getByText(/Reconnect in Accounts/i)).toBeInTheDocument();
  });

  it("renders a connected Threads account as a selectable destination", () => {
    render(<DestinationRail accounts={[threadsAccount]} selected={[]} onChange={vi.fn()} />);
    expect(screen.getByRole("checkbox", { name: /Publish to Studio on Threads/i })).toBeEnabled();
    expect(screen.getByText(/Threads/i)).toBeInTheDocument();
  });
});

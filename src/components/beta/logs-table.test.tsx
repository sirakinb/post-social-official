import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LogRow } from "@/lib/beta/logs";
vi.mock("@/app/beta/(app)/calendar/actions", () => ({ retry: vi.fn(), markPublished: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { LogsTable } = await import("./logs-table");

const failed: LogRow = {
  id: "e1", at: "2026-10-10T15:00:00Z", level: "error", eventType: "destination.failed", area: "posts", source: "worker",
  actorKind: "system", actorName: "Post Social", actorVia: null, summary: "Could not publish to Still Meditation",
  status: { label: "Failed", tone: "failed" }, error: { code: "media_rejected", message: "Instagram rejected the video: aspect ratio" },
  target: { platform: "instagram", account: "Still Meditation", postId: "p1" }, details: { after: { code: "media_rejected" } },
};

describe("LogsTable", () => {
  it("shows the failure reason on the line and the details when opened", () => {
    render(<LogsTable rows={[failed]} />);
    expect(screen.getByText("Instagram rejected the video: aspect ratio")).toBeTruthy();
    expect(screen.getByText("Publisher")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("media_rejected")).toBeTruthy();
    expect(screen.getByText("destination.failed")).toBeTruthy();
  });

  it("offers Retry on a failure that still stands, to people who can edit", () => {
    const standing = { ...failed, target: { ...failed.target!, accountId: "a1", status: "failed", mayBeLive: false } };
    const { unmount } = render(<LogsTable rows={[standing]} canEdit />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    unmount();

    // Already retried and live, or a reviewer looking: no button.
    const fixed = { ...standing, target: { ...standing.target, status: "published" } };
    const again = render(<LogsTable rows={[fixed]} canEdit />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    again.unmount();
    render(<LogsTable rows={[standing]} />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("says when nothing matches", () => {
    render(<LogsTable rows={[]} />);
    expect(screen.getByText("Nothing matches these filters.")).toBeTruthy();
  });
});

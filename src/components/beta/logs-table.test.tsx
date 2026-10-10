import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { LogRow } from "@/lib/beta/logs";
import { LogsTable } from "./logs-table";

const failed: LogRow = {
  id: "e1", at: "2026-10-10T15:00:00Z", level: "error", eventType: "destination.failed", area: "posts", source: "worker",
  actorKind: "system", actorName: "Post Social", summary: "Could not publish to Still Meditation",
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

  it("says when nothing matches", () => {
    render(<LogsTable rows={[]} />);
    expect(screen.getByText("Nothing matches these filters.")).toBeTruthy();
  });
});

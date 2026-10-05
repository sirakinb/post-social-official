import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ActivityFeed } from "./activity-feed";
import type { ActivityRow } from "@/lib/beta/home";

const rows: ActivityRow[] = [
  { id: "1", at: "2026-10-05T12:00:00Z", actorId: "a1", actorKind: "oauth_grant", actorName: "Claude", sentence: "scheduled a post", via: "via MCP", status: null },
  { id: "2", at: "2026-10-05T11:00:00Z", actorId: "a2", actorKind: "user", actorName: "Maya", sentence: "connected Instagram", via: "", status: null },
];
const actors = [
  { id: "a1", kind: "oauth_grant" as const, display_name: "Claude" },
  { id: "a2", kind: "user" as const, display_name: "Maya" },
];

describe("ActivityFeed", () => {
  // The Activity page is a server component: it can only pass plain values (a path), never
  // a function, or the page fails to render.
  it("turns a filter path into links for each person and AI", () => {
    render(<ActivityFeed rows={rows} actors={actors} filterPath="/beta/activity" activeActor="a1" />);
    expect(screen.getByRole("link", { name: "Everyone" })).toHaveAttribute("href", "/beta/activity");
    expect(screen.getByRole("link", { name: /Claude/ })).toHaveAttribute("href", "/beta/activity?who=a1");
    expect(screen.getByRole("link", { name: /Claude/ })).toHaveAttribute("aria-current", "true");
  });

  it("filters in place with buttons when there is no path", () => {
    render(<ActivityFeed rows={rows} actors={actors} />);
    expect(screen.getByRole("button", { name: "Everyone" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Everyone" })).toBeNull();
  });
});

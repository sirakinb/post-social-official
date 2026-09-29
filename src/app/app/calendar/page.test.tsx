import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import CalendarPage from "./page";

const mocks = vi.hoisted(() => ({
  posts: [] as Array<{
    _id: string;
    caption: string;
    status: "scheduled";
    scheduledAt: number;
    destinations: Array<{ platform: "tiktok" | "threads" }>;
  }>,
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock("convex/react", () => ({ useQuery: vi.fn(() => mocks.posts) }));
vi.mock("@/components/workspace-provider", () => ({
  useWorkspace: () => ({ mode: "live", workspaceId: "ws_1", name: "Test Workspace", approvalPolicy: "confirm_each" }),
}));
vi.mock("../../../../convex/_generated/api", () => ({ api: { posts: { list: "posts.list" } } }));

describe("CalendarPage", () => {
  beforeEach(() => { mocks.posts = []; });

  it("keeps the actual 42-day month grid when no posts are scheduled", () => {
    render(<CalendarPage />);
    const grid = screen.getByRole("grid");
    expect(grid).toHaveAttribute("aria-label", expect.stringMatching(/Month view for/i));
    expect(grid.children).toHaveLength(42);
    for (const day of ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) {
      expect(screen.getByText(day)).toBeInTheDocument();
    }
    expect(screen.getByText(/Nothing scheduled this month\. Choose a date/i)).toBeInTheDocument();
  });

  it("preserves month navigation and renders scheduled posts in the grid", () => {
    mocks.posts = [{
      _id: "post_1",
      caption: "Launch day post",
      status: "scheduled",
      scheduledAt: Date.now(),
      destinations: [{ platform: "tiktok" }],
    }];
    render(<CalendarPage />);
    expect(screen.getByRole("button", { name: /Previous month/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Next month/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Today/i })).toBeInTheDocument();
    expect(screen.getAllByText("Launch day post")).not.toHaveLength(0);
  });

  it("shows the Threads channel abbreviation", () => {
    mocks.posts = [{
      _id: "post_2",
      caption: "Threads post",
      status: "scheduled",
      scheduledAt: Date.now(),
      destinations: [{ platform: "threads" }],
    }];
    render(<CalendarPage />);
    expect(screen.getByText("TH")).toBeInTheDocument();
  });
});

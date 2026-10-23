import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import QuickstartPage from "./page";

vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => React.createElement("img", { src, alt }),
}));

describe("QuickstartPage", () => {
  it("walks through the five steps, with the connect address", () => {
    render(<QuickstartPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Quickstart: your first post" })).toBeInTheDocument();
    for (const name of ["Connect your first account", "Connect Claude or ChatGPT", "Send your first post", "Check that it went out", "If something fails"]) {
      expect(screen.getByRole("heading", { level: 2, name })).toBeInTheDocument();
    }
    expect(screen.getAllByText("https://www.postsocial.xyz/mcp").length).toBeGreaterThan(0);
  });

  it("shows a screenshot for each of the first four steps, each described", () => {
    render(<QuickstartPage />);
    const images = Array.from(document.querySelectorAll("img"));
    expect(images.map((i) => i.getAttribute("src"))).toEqual([
      "/docs/quickstart/connect-account.webp",
      "/docs/quickstart/connect-claude.webp",
      "/docs/quickstart/first-post.webp",
      "/docs/quickstart/check-results.webp",
    ]);
    for (const image of images) expect(image.getAttribute("alt")?.length).toBeGreaterThan(20);
    expect(screen.queryByText("Screenshot to add")).toBeNull();
  });

  it("links on to the connect and tools pages, and back to the docs", () => {
    render(<QuickstartPage />);
    expect(screen.getByRole("link", { name: "Connect Claude Code, Cursor or another MCP app" })).toHaveAttribute("href", "/docs/connect");
    expect(screen.getByRole("link", { name: "See everything your AI can do" })).toHaveAttribute("href", "/docs/tools");
    expect(screen.getByRole("link", { name: "Back to the docs" })).toHaveAttribute("href", "/docs");
  });
});

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import QuickstartPage from "./page";

describe("QuickstartPage", () => {
  it("walks through the five steps, with the connect address", () => {
    render(<QuickstartPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Quickstart: your first post" })).toBeInTheDocument();
    for (const name of ["Connect your first account", "Connect Claude or ChatGPT", "Send your first post", "Check that it went out", "If something fails"]) {
      expect(screen.getByRole("heading", { level: 2, name })).toBeInTheDocument();
    }
    expect(screen.getAllByText("https://www.postsocial.xyz/mcp").length).toBeGreaterThan(0);
  });

  it("marks where screenshots belong instead of showing images", () => {
    render(<QuickstartPage />);
    expect(screen.getAllByText("Screenshot to add").length).toBeGreaterThanOrEqual(4);
    expect(document.querySelector("img")).toBeNull();
  });

  it("links on to the connect and tools pages, and back to the docs", () => {
    render(<QuickstartPage />);
    expect(screen.getByRole("link", { name: "Connect Claude Code, Cursor or another MCP app" })).toHaveAttribute("href", "/docs/connect");
    expect(screen.getByRole("link", { name: "See everything your AI can do" })).toHaveAttribute("href", "/docs/tools");
    expect(screen.getByRole("link", { name: "Back to the docs" })).toHaveAttribute("href", "/docs");
  });
});

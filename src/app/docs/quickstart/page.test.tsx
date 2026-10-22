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

  it("links back to the docs and billing", () => {
    render(<QuickstartPage />);
    expect(screen.getAllByRole("link", { name: "Docs" })[0]).toHaveAttribute("href", "/docs");
    expect(screen.getAllByRole("link", { name: "Billing" })[0]).toHaveAttribute("href", "/docs/billing");
  });
});

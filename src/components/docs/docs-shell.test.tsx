import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DocsShell } from "./docs-shell";

const path = "/docs/concepts";
vi.mock("next/navigation", () => ({ usePathname: () => path }));

describe("DocsShell", () => {
  it("shows grouped sidebar links with the current page marked", () => {
    render(<DocsShell cta={<a href="/signup">Start for free</a>}><h1>Page</h1></DocsShell>);
    const nav = screen.getByRole("navigation", { name: "Docs sections" });
    expect(within(nav).getByRole("link", { name: "Concepts" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Quickstart" })).toHaveAttribute("href", "/docs/quickstart");
    expect(screen.getByRole("link", { name: "Start for free" })).toBeInTheDocument();
  });

  it("links to the previous and next pages", () => {
    render(<DocsShell cta={null}>x</DocsShell>);
    const pager = screen.getByRole("navigation", { name: "Previous and next pages" });
    expect(within(pager).getByRole("link", { name: /Quickstart/ })).toHaveAttribute("href", "/docs/quickstart");
    expect(within(pager).getByRole("link", { name: /Connect an AI/ })).toHaveAttribute("href", "/docs/connect");
  });

  it("searches the docs pages", () => {
    render(<DocsShell cta={null}>x</DocsShell>);
    fireEvent.change(screen.getAllByLabelText("Search the docs")[0], { target: { value: "rest" } });
    const results = screen.getAllByRole("list", { name: "Search results" })[0];
    expect(within(results).getByRole("link", { name: /REST API/ })).toHaveAttribute("href", "/docs/api");
  });

  it("opens and closes the menu on small screens", () => {
    render(<DocsShell cta={null}>x</DocsShell>);
    const button = screen.getByRole("button", { name: "Open menu" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    expect(screen.getAllByRole("button", { name: "Close menu" }).length).toBeGreaterThan(0);
  });
});

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "./sidebar";

const path = vi.hoisted(() => ({ current: "/beta/api" }));
vi.mock("next/navigation", () => ({ usePathname: () => path.current }));
vi.mock("@/components/analytics/identify", () => ({ forgetViewer: () => {} }));

const props = { viewer: { name: "Aki", email: "aki@example.com", avatarUrl: null }, plan: null, signOut: async () => {} };

describe("Sidebar", () => {
  it("lists every page in one flat list, with Accounts and API/MCP as separate tabs", () => {
    render(<Sidebar {...props} />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).queryByText("Connect")).toBeNull();
    expect(within(nav).queryByText("Accounts & AI")).toBeNull();
    expect(screen.getByRole("link", { name: "Accounts" })).toHaveAttribute("href", "/beta/accounts");
    expect(screen.getByRole("link", { name: "API/MCP" })).toHaveAttribute("href", "/beta/api");
  });

  it("keeps General, Billing and On your phone in a Settings dropdown", async () => {
    const { fireEvent } = await import("@testing-library/react");
    render(<Sidebar {...props} />);
    const settings = screen.getByRole("button", { name: "Settings" });
    expect(settings).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "Billing" })).toBeNull();
    fireEvent.click(settings);
    expect(settings).toHaveAttribute("aria-expanded", "true");
    const menu = within(document.getElementById("settings-menu")!);
    expect(menu.getAllByRole("link").map((l) => [l.textContent, l.getAttribute("href")])).toEqual([
      ["General", "/beta/settings"],
      ["Billing", "/beta/billing"],
      ["On your phone", "/beta/phone"],
    ]);
  });

  it("starts the Settings dropdown open on one of its pages", () => {
    path.current = "/beta/billing";
    render(<Sidebar {...props} />);
    expect(screen.getByRole("button", { name: "Settings" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Billing" })).toHaveAttribute("aria-current", "page");
    path.current = "/beta/api";
  });

  it("shows Analytics after Calendar only where a stats source is on", () => {
    render(<Sidebar {...props} analytics />);
    const labels = screen.getAllByRole("link").map((l) => l.textContent).filter((t) => t !== "New post");
    expect(labels.slice(0, 5)).toEqual(["Accounts", "Create", "Drafts", "Calendar", "Analytics"]);
    expect(screen.getByRole("link", { name: "Analytics" })).toHaveAttribute("href", "/beta/analytics");
  });

  it("starts with Accounts then Create, with no Home, Media or Stats", () => {
    render(<Sidebar {...props} />);
    const labels = screen.getAllByRole("link").map((l) => l.textContent).filter((t) => t !== "New post");
    expect(labels.slice(0, 2)).toEqual(["Accounts", "Create"]);
    for (const gone of ["Home", "Media", "Stats", "Analytics"]) expect(screen.queryByRole("link", { name: gone })).toBeNull();
  });

  it("puts Drafts right after Create", () => {
    render(<Sidebar {...props} />);
    const labels = screen.getAllByRole("link").map((l) => l.textContent).filter((t) => t !== "New post");
    expect(labels.slice(0, 4)).toEqual(["Accounts", "Create", "Drafts", "Calendar"]);
    expect(screen.getByRole("link", { name: "Drafts" })).toHaveAttribute("href", "/beta/drafts");
  });

  it("opens the docs in a new tab", () => {
    render(<Sidebar {...props} />);
    const docs = screen.getByRole("link", { name: /Docs/ });
    expect(docs).toHaveAttribute("href", "/docs");
    expect(docs).toHaveAttribute("target", "_blank");
  });

  it("marks API/MCP current on the old keys address too", () => {
    path.current = "/beta/keys";
    render(<Sidebar {...props} />);
    expect(screen.getByRole("link", { name: "API/MCP" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Accounts" })).not.toHaveAttribute("aria-current");
  });

  it("shows who is signed in at the top instead of the workspace, and only Sign out at the bottom", () => {
    render(<Sidebar {...props} />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByText("Aki")).toBeTruthy();
    expect(within(nav).getByText("aki@example.com")).toBeTruthy();
    expect(within(nav).queryByText("owner")).toBeNull();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });

  it("folds into a Menu button on phones, with New post always in reach", async () => {
    const { fireEvent } = await import("@testing-library/react");
    render(<Sidebar {...props} />);
    expect(screen.getByRole("link", { name: "New post" })).toHaveAttribute("href", "/beta/create");
    const menu = screen.getByRole("button", { name: "Menu" });
    expect(menu).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById("main-menu")).toHaveClass("hidden", "md:flex");
    fireEvent.click(menu);
    expect(menu).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById("main-menu")).not.toHaveClass("hidden");
  });
});

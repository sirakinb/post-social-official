import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "./sidebar";

const path = vi.hoisted(() => ({ current: "/beta/api" }));
vi.mock("next/navigation", () => ({ usePathname: () => path.current }));
vi.mock("@/components/analytics/identify", () => ({ forgetViewer: () => {} }));

const props = { workspaceName: "Pentridge", viewer: { name: "Aki", avatarUrl: null, role: "owner" }, plan: null, statsEnabled: false, signOut: async () => {} };

describe("Sidebar", () => {
  it("lists every page in one flat list, with Accounts and API/MCP as separate tabs", () => {
    render(<Sidebar {...props} />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).queryByText("Connect")).toBeNull();
    expect(within(nav).queryByText("Accounts & AI")).toBeNull();
    expect(screen.getByRole("link", { name: "Accounts" })).toHaveAttribute("href", "/beta/accounts");
    expect(screen.getByRole("link", { name: "API/MCP" })).toHaveAttribute("href", "/beta/api");
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/beta/settings");
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
});

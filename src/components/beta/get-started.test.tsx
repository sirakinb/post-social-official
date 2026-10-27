import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GetStartedPanel } from "./get-started";

const hide = async () => {};

describe("GetStartedPanel", () => {
  it("lists the three steps, and sends a new workspace to the platform buttons instead of a button of its own", () => {
    render(<GetStartedPanel steps={{ account: false, ai: false, post: false }} hide={hide} />);
    const panel = screen.getByRole("region", { name: "Get started" });
    expect(within(panel).getByText("0 of 3 done")).toBeInTheDocument();
    expect(within(panel).getAllByRole("listitem").map((li) => li.querySelector(".font-medium")?.textContent)).toEqual(["Connect a social account", "Connect your AI", "Send your first post"]);
    expect(within(panel).queryByRole("link", { name: "Connect" })).toBeNull();
    expect(within(panel).getByText(/under Connect an account below/)).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "Set up" })).toHaveAttribute("href", "/beta/api");
    expect(within(panel).getByRole("link", { name: "Create a post" })).toHaveAttribute("href", "/beta/create");
  });

  it("ticks off what's done and moves the main button to the next step", () => {
    render(<GetStartedPanel steps={{ account: true, ai: false, post: false }} hide={hide} />);
    expect(screen.getByText("1 of 3 done")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Connect" })).toBeNull();
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set up" }).className).toContain("bg-ps-plum");
    expect(screen.getByRole("link", { name: "Create a post" }).className).not.toContain("bg-ps-plum");
  });

  it("links the one-minute walkthrough and can be hidden", () => {
    render(<GetStartedPanel steps={{ account: false, ai: false, post: false }} hide={hide} />);
    expect(screen.getByRole("link", { name: /Watch the 1-minute walkthrough/ })).toHaveAttribute("href", "/docs/quickstart");
    expect(screen.getByRole("button", { name: "Hide" })).toBeInTheDocument();
  });
});

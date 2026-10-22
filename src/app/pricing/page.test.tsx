import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import React from "react";
import PricingPage from "./page";

vi.mock("../fonts", () => ({ Fraunces: { variable: "font-fraunces" }, GeistPixelGrid: { variable: "font-pixel" } }));
vi.mock("../waitlist-action", () => ({ joinWaitlist: vi.fn(async () => ({ ok: true })) }));

describe("PricingPage", () => {
  it("shows the single plan with the account ladder and a start call to action", () => {
    render(<PricingPage />);
    expect(screen.getByRole("heading", { level: 1, name: /Start free\. Pay only for the accounts you use\./ })).toBeInTheDocument();
    const ladder = screen.getByRole("list", { name: "Price per account" });
    expect(within(ladder).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["1–2Free", "3–10$5/mo", "11–100$2.50/mo", "101+$1/mo"]);
    expect(screen.getByText("2 accounts free to start, no card needed")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Join the waitlist|Start for free/ }).length + screen.queryAllByRole("link", { name: "Start for free" }).length).toBeGreaterThan(0);
  });

  it("drops the X posts bullet and the agencies card", () => {
    render(<PricingPage />);
    expect(document.body.textContent).not.toMatch(/X posts at X|Agencies|Hundreds of accounts|Talk to us/);
    expect(document.querySelector('a[href^="mailto:"]')).toBeNull();
  });

  it("links the header Pricing item to this page", () => {
    render(<PricingPage />);
    const nav = screen.getByRole("navigation", { name: "Landing page" });
    expect(within(nav).getByRole("link", { name: "Pricing" })).toHaveAttribute("href", "/pricing");
    expect(within(nav).getByRole("link", { name: "FAQ" })).toHaveAttribute("href", "/#faq");
  });
});

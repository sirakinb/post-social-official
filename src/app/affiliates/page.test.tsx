import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import React from "react";
import AffiliatesPage from "./page";

vi.mock("../fonts", () => ({ Fraunces: { variable: "font-fraunces" }, GeistPixelGrid: { variable: "font-pixel" } }));
vi.mock("../waitlist-action", () => ({ joinWaitlist: vi.fn(async () => ({ ok: true })) }));

describe("AffiliatesPage", () => {
  it("shows the 20% for 24 months offer and an apply-by-email button", () => {
    render(<AffiliatesPage />);
    expect(screen.getByRole("heading", { level: 1, name: /Earn 20% for 24 months/ })).toBeInTheDocument();
    const buttons = screen.getAllByRole("link", { name: "Apply to join" });
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) expect(button).toHaveAttribute("href", "mailto:hello@postsocial.xyz?subject=Affiliate%20application");
  });

  it("doesn't link to Rewardful's open sign-up page", () => {
    render(<AffiliatesPage />);
    expect(document.body.innerHTML).not.toMatch(/getrewardful\.com/);
  });

  it("says who it is for, how it works and answers common questions", () => {
    render(<AffiliatesPage />);
    for (const name of ["Friends of Post Social", "Creators who use AI tools", "Agencies and operators", "Apply", "Share your link", "Get paid"]) expect(screen.getByRole("heading", { level: 3, name })).toBeInTheDocument();
    expect(screen.getByText("Can I refer myself?")).toBeInTheDocument();
  });

  it("makes no claims about earnings, user counts or badges", () => {
    render(<AffiliatesPage />);
    expect(screen.getByRole("main").textContent).not.toMatch(/\$\d|per month on average|users|featured/);
  });

  it("links to the affiliate page from the footer", () => {
    render(<AffiliatesPage />);
    expect(within(screen.getByRole("navigation", { name: "Legal" })).getByRole("link", { name: "Affiliates" })).toHaveAttribute("href", "/affiliates");
  });
});

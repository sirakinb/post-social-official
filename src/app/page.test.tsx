import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import React from "react";
import LandingPage from "./page";

vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => React.createElement("div", { "data-testid": "hero-image", "data-src": src, "data-alt": alt }),
}));
vi.mock("./fonts", () => ({ Fraunces: { variable: "font-fraunces" }, GeistPixelGrid: { variable: "font-pixel" } }));
// Canvas and WebGL layers draw nothing in jsdom; the wordmark keeps its accessible name.
vi.mock("@/components/landing/dusk-sky", () => ({ DuskSky: () => null }));
vi.mock("@/components/landing/particle-wordmark", () => ({
  ParticleWordmark: ({ label }: { label: string }) => React.createElement("canvas", { role: "img", "aria-label": label }),
}));
vi.mock("./waitlist-action", () => ({ joinWaitlist: vi.fn(async () => ({ ok: true })) }));

describe("LandingPage", () => {
  it("keeps the headline, with the two words set in the display face", () => {
    render(<LandingPage />);
    const h1 = screen.getByRole("heading", { level: 1, name: /Social media posting for AI-native creators and operators/i });
    expect(within(h1).getByText("AI-native")).toHaveClass("lp-display");
    expect(within(h1).getByText("operators")).toHaveClass("lp-display");
  });

  it("shows the particle wordmark and the dusk painting", () => {
    render(<LandingPage />);
    expect(screen.getByRole("img", { name: "Post Social" })).toBeInTheDocument();
    expect(screen.getByTestId("hero-image")).toHaveAttribute("data-src", "/landing/hero-dusk-2560.webp");
  });

  it("names only the platforms that work today", () => {
    render(<LandingPage />);
    const body = document.body.textContent ?? "";
    for (const name of ["TikTok", "Instagram", "Facebook", "Threads", "YouTube"]) expect(body).toContain(name);
    expect(body).not.toMatch(/LinkedIn|Bluesky/);
    expect(body).not.toMatch(/\d+%|free trial|testimonial/i);
  });

  it("links to sign in, docs and the legal pages", () => {
    render(<LandingPage />);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/beta/login");
    const legal = screen.getByRole("navigation", { name: "Legal" });
    expect(within(legal).getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
    expect(within(legal).getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
    expect(within(legal).getByRole("link", { name: "Docs" })).toHaveAttribute("href", "/docs");
  });

  it("opens the waitlist form from the main button and closes it with Escape", () => {
    render(<LandingPage />);
    fireEvent.click(screen.getByRole("button", { name: "Join the waitlist" }));
    const dialog = screen.getByRole("dialog", { name: "Join the waitlist" });
    expect(within(dialog).getByLabelText("Email address")).toHaveAttribute("type", "email");
    expect(within(dialog).getByLabelText("Email address")).toHaveFocus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

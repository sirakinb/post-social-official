import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import React from "react";
import LandingPage from "./page";

vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => React.createElement("div", { "data-testid": "image", "data-src": src, "data-alt": alt }),
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

  it("opens at dusk with the particle wordmark and the platforms that work today", () => {
    render(<LandingPage />);
    expect(screen.getByRole("img", { name: "Post Social" })).toBeInTheDocument();
    const images = screen.getAllByTestId("image").map((i) => i.getAttribute("data-src"));
    expect(images).toContain("/landing/hero-dusk-2560.webp");
    const strip = screen.getByRole("list", { name: /Publishes to TikTok, Instagram, Facebook Pages, Threads and YouTube/ });
    expect(within(strip).getAllByRole("listitem")).toHaveLength(5);
  });

  it("links each section from the header", () => {
    render(<LandingPage />);
    const nav = screen.getByRole("navigation", { name: "Landing page" });
    for (const [label, id] of [["Use with AI", "agents"], ["How it works", "how-it-works"], ["Features", "features"], ["Platforms", "platforms"], ["FAQ", "faq"]]) {
      expect(within(nav).getByRole("link", { name: label })).toHaveAttribute("href", `#${id}`);
      expect(document.getElementById(id)).not.toBeNull();
    }
  });

  it("shows real screens from the app, each described", () => {
    render(<LandingPage />);
    const screens = screen.getAllByTestId("image").filter((i) => i.getAttribute("data-src")?.startsWith("/landing/app-"));
    expect(screens.map((i) => i.getAttribute("data-src"))).toEqual(
      expect.arrayContaining(["/landing/app-home.webp", "/landing/app-create.webp", "/landing/app-calendar.webp", "/landing/app-activity.webp", "/landing/app-accounts.webp"]),
    );
    for (const s of screens) expect(s.getAttribute("data-alt")?.length).toBeGreaterThan(10);
  });

  it("is honest about platforms: five live, three marked as coming next", () => {
    render(<LandingPage />);
    const platforms = document.getElementById("platforms") as HTMLElement;
    for (const name of ["TikTok", "Instagram", "Facebook Pages", "Threads", "YouTube", "Coming next"]) {
      expect(within(platforms).getByRole("heading", { name })).toBeInTheDocument();
    }
    expect(within(platforms).getByText("LinkedIn, Bluesky and X.")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\d+%|free trial|testimonial|eight destinations/i);
  });

  it("answers common questions in an accessible list", () => {
    render(<LandingPage />);
    const faq = document.getElementById("faq") as HTMLElement;
    expect(faq.querySelectorAll("details").length).toBeGreaterThanOrEqual(6);
    expect(within(faq).getByText("Can an AI publish for me?")).toBeInTheDocument();
  });

  it("links to sign in, docs and the legal pages", () => {
    render(<LandingPage />);
    expect(screen.getAllByRole("link", { name: "Sign in" })[0]).toHaveAttribute("href", "/beta/login");
    const legal = screen.getByRole("navigation", { name: "Legal" });
    for (const [name, href] of [["Docs", "/docs"], ["Privacy", "/privacy"], ["Terms", "/terms"], ["Data deletion", "/data-deletion"]]) {
      expect(within(legal).getByRole("link", { name })).toHaveAttribute("href", href);
    }
  });

  it("every waitlist button opens the form, and Escape closes it", () => {
    render(<LandingPage />);
    const buttons = screen.getAllByRole("button", { name: /Join the waitlist|Get early access/ });
    expect(buttons.length).toBeGreaterThanOrEqual(3);
    fireEvent.click(buttons[0]);
    const dialog = screen.getByRole("dialog", { name: "Join the waitlist" });
    expect(within(dialog).getByLabelText("Email address")).toHaveFocus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

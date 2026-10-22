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
    const h1 = screen.getByRole("heading", { level: 1, name: /Social media management for AI-native creators and operators/i });
    expect(within(h1).getByText("AI-native")).toHaveClass("lp-display");
    expect(within(h1).getByText("operators")).toHaveClass("lp-display");
  });

  it("opens at dusk with the particle wordmark and the platforms that work today", () => {
    render(<LandingPage />);
    expect(screen.getByRole("img", { name: "Post Social" })).toBeInTheDocument();
    const images = screen.getAllByTestId("image").map((i) => i.getAttribute("data-src"));
    expect(images).toContain("/landing/hero-dusk-2560.webp");
    const strip = screen.getByRole("list", { name: /Publishes to TikTok, Instagram, Facebook Pages, Threads, YouTube, LinkedIn, Bluesky and X/ });
    expect(within(strip).getAllByRole("listitem")).toHaveLength(8);
  });

  it("links each section from the header", () => {
    render(<LandingPage />);
    const nav = screen.getByRole("navigation", { name: "Landing page" });
    for (const [label, id] of [["AI agents", "agents"], ["How it works", "how-it-works"], ["Features", "features"], ["Platforms", "platforms"], ["FAQ", "faq"]]) {
      expect(within(nav).getByRole("link", { name: label })).toHaveAttribute("href", `#${id}`);
      expect(document.getElementById(id)).not.toBeNull();
    }
  });

  it("sends Pricing to its own page and no longer shows pricing on the landing", () => {
    render(<LandingPage />);
    const nav = screen.getByRole("navigation", { name: "Landing page" });
    expect(within(nav).getByRole("link", { name: "Pricing" })).toHaveAttribute("href", "/pricing");
    expect(document.getElementById("pricing")).toBeNull();
    expect(screen.queryByLabelText("Number of connected accounts")).toBeNull();
  });

  it("shows real Claude screenshots and stays light on app screens, each described", () => {
    render(<LandingPage />);
    const screens = screen.getAllByTestId("image").filter((i) => /^\/landing\/(app|claude)-/.test(i.getAttribute("data-src") ?? ""));
    expect(screens.map((i) => i.getAttribute("data-src"))).toEqual(["/landing/claude-chat.webp", "/landing/claude-connector.webp", "/landing/app-home.webp"]);
    for (const s of screens) expect(s.getAttribute("data-alt")?.length).toBeGreaterThan(10);
    // The real chat sits in the Use with AI section; the connector permissions sit under Features.
    expect(document.querySelector('#agents [data-src="/landing/claude-chat.webp"]')).not.toBeNull();
    expect(document.querySelector('#features [data-src="/landing/claude-connector.webp"]')).not.toBeNull();
    // The Claude chat is labelled as Claude; the app's own screen needs no label.
    expect(within(document.getElementById("agents") as HTMLElement).getByText("Claude")).toBeInTheDocument();
    expect(within(document.getElementById("features") as HTMLElement).queryByText("Post Social")).toBeNull();
  });

  it("is honest about platforms: eight live, nothing promised", () => {
    render(<LandingPage />);
    const platforms = document.getElementById("platforms") as HTMLElement;
    const list = within(platforms).getByRole("list", { name: "Supported platforms" });
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["TikTok", "Instagram", "Facebook Pages", "Threads", "YouTube", "LinkedIn", "Bluesky", "X"]);
    expect(document.body.textContent).not.toMatch(/\d+%|free trial|testimonial|eight destinations/i);
  });

  it("plays the product video in the hero, with captions", () => {
    render(<LandingPage />);
    const video = document.querySelector("#demo video") as HTMLVideoElement;
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute("controls");
    expect(video).toHaveAttribute("preload", "none");
    expect(video).toHaveAttribute("poster", "/landing/product-video-poster.webp");
    expect(video.querySelector("source")).toHaveAttribute("src", "/landing/product-video.mp4");
    expect(video.querySelector("track")).toHaveAttribute("src", "/landing/product-video.vtt");
    expect(video.getAttribute("aria-label")?.length).toBeGreaterThan(10);
    expect(screen.queryByRole("img", { name: "Product video coming soon" })).toBeNull();
    const agents = document.getElementById("agents") as HTMLElement;
    expect(video.compareDocumentPosition(agents) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText("Stop rebuilding the same post five times.")).toBeNull();
  });

  it("keeps the testimonials section hidden until there are real quotes", () => {
    render(<LandingPage />);
    expect(document.getElementById("people")).toBeNull();
  });

  it("answers common questions in an accessible list", () => {
    render(<LandingPage />);
    const faq = document.getElementById("faq") as HTMLElement;
    expect(faq.querySelectorAll("details").length).toBeGreaterThanOrEqual(6);
    expect(within(faq).getByText("Can my AI agent publish for me?")).toBeInTheDocument();
  });

  it("links to sign in, docs and the legal pages", () => {
    render(<LandingPage />);
    expect(screen.getAllByRole("link", { name: "Sign in" })[0]).toHaveAttribute("href", "/beta/login");
    const legal = screen.getByRole("navigation", { name: "Legal" });
    for (const [name, href] of [["Docs", "/docs"], ["Privacy", "/privacy"], ["Terms", "/terms"], ["Data deletion", "/data-deletion"]]) {
      expect(within(legal).getByRole("link", { name })).toHaveAttribute("href", href);
    }
    // Fine print beside the copyright, not among the legal links.
    expect(within(legal).queryByRole("link", { name: "Changelog" })).toBeNull();
    expect(screen.getByRole("link", { name: "Changelog" })).toHaveAttribute("href", "/changelog");
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

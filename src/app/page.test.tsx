import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import React from "react";
import LandingPage from "./page";

vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) =>
    React.createElement("div", { "data-testid": "avatar-image", "data-src": src, "data-alt": alt }),
}));

describe("LandingPage", () => {
  it("renders the hero headline and platform strip", () => {
    render(<LandingPage />);
    expect(
      screen.getByRole("heading", { level: 1, name: /Social media posting for AI-native creators and operators/i })
    ).toBeInTheDocument();
    const strip = screen.getByLabelText(/TikTok, Instagram, Facebook Pages, Threads, YouTube, LinkedIn, Bluesky, and X/i);
    expect(within(strip).getByRole("img", { name: /TikTok/i })).toBeInTheDocument();
    expect(within(strip).getByRole("img", { name: /Instagram/i })).toBeInTheDocument();
    expect(within(strip).getByRole("img", { name: /Facebook/i })).toBeInTheDocument();
    expect(within(strip).getByRole("img", { name: /Threads/i })).toBeInTheDocument();
    expect(within(strip).getByRole("img", { name: /YouTube/i })).toBeInTheDocument();
    expect(within(strip).getByRole("img", { name: /LinkedIn/i })).toBeInTheDocument();
    expect(within(strip).getByRole("img", { name: /Bluesky/i })).toBeInTheDocument();
    expect(within(strip).getByRole("img", { name: /X/i })).toBeInTheDocument();
  });

  it("renders the primary CTA linking to login with visitor-owned language", () => {
    render(<LandingPage />);
    const ctas = screen.getAllByRole("link", { name: /Start my first post/i });
    expect(ctas.length).toBeGreaterThanOrEqual(1);
    ctas.forEach((cta) => {
      expect(cta).toHaveAttribute("href", "/login");
    });
  });

  it("renders anchor navigation for each section", () => {
    render(<LandingPage />);
    ["Use with AI", "How it works", "Features", "Platforms", "FAQ"].forEach((label) => {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    });
  });

  it("mentions only the supported platforms without inventing metrics", () => {
    render(<LandingPage />);
    expect(screen.getAllByText(/TikTok/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Instagram/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Facebook Pages/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Threads/i).length).toBeGreaterThan(0);

    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/\d+%/);
    expect(body).not.toMatch(/free trial/i);
    expect(body).not.toMatch(/testimonial/i);
  });

  it("renders the FAQ as an accessible details list", () => {
    render(<LandingPage />);
    expect(screen.getByText(/Which platforms are supported\?/i)).toBeInTheDocument();
    expect(screen.getByText(/Can an AI agent publish for me\?/i)).toBeInTheDocument();
    expect(document.querySelectorAll("details").length).toBeGreaterThanOrEqual(6);
  });

  it("leads with posting from AI assistants", () => {
    render(<LandingPage />);
    const agents = document.getElementById("agents");
    expect(agents).not.toBeNull();
    expect(agents).toHaveTextContent(/Post from ChatGPT, Claude, or any AI you already use/i);
    expect(agents).toHaveTextContent(/publishes or schedules it directly/i);
    expect(document.body.textContent).not.toMatch(/Your accounts stay yours/i);
    expect(document.body.textContent).not.toMatch(/never ask for your social passwords/i);
  });

  it("shows all eight destinations in the platforms section", () => {
    render(<LandingPage />);
    const platforms = document.getElementById("platforms");
    expect(platforms).not.toBeNull();
    ["TikTok", "Instagram", "Facebook Pages", "Threads", "YouTube", "LinkedIn", "Bluesky", "X"].forEach((name) => {
      expect(within(platforms as HTMLElement).getByRole("heading", { name: new RegExp(`^${name}`) })).toBeInTheDocument();
    });
  });

  it("shows a video placeholder in the hero with no real account names", () => {
    render(<LandingPage />);
    expect(screen.getByRole("img", { name: /Product video coming soon/i })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Sirakinb|Still Meditation/i);
  });

  it("renders the real product screenshots with useful alt text", () => {
    render(<LandingPage />);
    const images = screen.getAllByTestId("avatar-image");
    const screenshots = images.filter((img) =>
      img.getAttribute("data-src")?.startsWith("/landing/post-social-"),
    );

    expect(screenshots).toHaveLength(3);
    expect(screenshots.map((img) => img.getAttribute("data-src"))).toEqual(
      expect.arrayContaining([
        "/landing/post-social-create.png",
        "/landing/post-social-calendar.png",
        "/landing/post-social-activity.png",
      ]),
    );

    screenshots.forEach((img) => {
      const alt = img.getAttribute("data-alt");
      expect(alt).toBeTruthy();
      expect(alt?.length).toBeGreaterThan(5);
    });
  });
});

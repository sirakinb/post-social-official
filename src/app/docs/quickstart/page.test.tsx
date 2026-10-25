import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import QuickstartPage from "./page";

vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => React.createElement("img", { src, alt }),
}));

describe("QuickstartPage", () => {
  it("walks through the five steps, with the connect address", () => {
    render(<QuickstartPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Quickstart: your first post" })).toBeInTheDocument();
    for (const name of ["Connect your first account", "Connect Claude, ChatGPT or any AI agent", "Send your first post", "Check that it went out", "If something fails"]) {
      expect(screen.getByRole("heading", { level: 2, name })).toBeInTheDocument();
    }
    expect(screen.getAllByText("https://www.postsocial.xyz/mcp").length).toBeGreaterThan(0);
  });

  it("plays the one-minute walkthrough, with captions", () => {
    render(<QuickstartPage />);
    const video = document.querySelector("video") as HTMLVideoElement;
    expect(video).toHaveAttribute("controls");
    expect(video).toHaveAttribute("preload", "none");
    expect(video).toHaveAttribute("poster", "/docs/quickstart/walkthrough-poster.webp");
    expect(video.querySelector("source")).toHaveAttribute("src", "/docs/quickstart/walkthrough.mp4");
    expect(video.querySelector("track")).toHaveAttribute("src", "/docs/quickstart/walkthrough.vtt");
    expect(video.getAttribute("aria-label")?.length).toBeGreaterThan(20);
  });

  it("shows a screenshot for each of the first four steps, each described", () => {
    render(<QuickstartPage />);
    const images = Array.from(document.querySelectorAll("img"));
    expect(images.map((i) => i.getAttribute("src"))).toEqual([
      "/docs/quickstart/connect-account.webp",
      "/docs/quickstart/connect-claude.webp",
      "/docs/quickstart/first-post.webp",
      "/docs/quickstart/check-results.webp",
    ]);
    for (const image of images) expect(image.getAttribute("alt")?.length).toBeGreaterThan(20);
    expect(screen.queryByText("Screenshot to add")).toBeNull();
  });

  it("links on to the connect and tools pages, and back to the docs", () => {
    render(<QuickstartPage />);
    expect(screen.getByRole("link", { name: "Connect Claude Code, Codex, Grok or another AI app" })).toHaveAttribute("href", "/docs/connect");
    expect(screen.getByRole("link", { name: "See everything your AI can do" })).toHaveAttribute("href", "/docs/tools");
    expect(screen.getByRole("link", { name: "Back to the docs" })).toHaveAttribute("href", "/docs");
  });
});

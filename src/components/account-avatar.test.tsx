import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import React from "react";
import { AccountAvatar } from "./account-avatar";

vi.mock("next/image", () => ({
  default: ({
    src,
    alt,
    onError,
    unoptimized: _unoptimized,
    ...rest
  }: {
    src: string;
    alt: string;
    onError?: React.ReactEventHandler<HTMLImageElement>;
    unoptimized?: boolean;
  }) =>
    React.createElement("img", {
      "data-testid": "avatar-image",
      "data-src": src,
      "data-alt": alt,
      src,
      alt,
      onError,
      ...rest,
    }),
}));

describe("AccountAvatar", () => {
  it("preserves the real account photo", () => {
    render(<AccountAvatar platform="instagram" src="https://example.com/avatar.jpg" name="Studio" />);
    expect(screen.getByTestId("avatar-image")).toHaveAttribute("data-src", "https://example.com/avatar.jpg");
    expect(screen.getByTestId("avatar-image")).toHaveAttribute("data-alt", "Studio");
  });

  it("renders the platform fallback when there is no remote photo", () => {
    render(<AccountAvatar platform="facebook" name="Studio" />);
    expect(screen.queryByTestId("avatar-image")).not.toBeInTheDocument();
    const fallback = screen.getByRole("img", { name: "Studio" });
    expect(fallback).toHaveAttribute("data-platform", "facebook");
    expect(fallback.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it.each([
    ["tiktok", "bg-[#010101]"],
    ["instagram", "bg-gradient-to-tr"],
    ["facebook", "bg-[#1877F2]"],
  ] as const)("renders the exact %s brand glyph without initials", (platform, expectedClass) => {
    const { container } = render(<AccountAvatar platform={platform} name="Studio" />);
    const svg = container.querySelector(`svg[data-brand-icon="${platform}"]`);
    expect(svg).toHaveAttribute("viewBox", "0 0 24 24");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg?.closest("span")).toHaveClass(expectedClass);
    expect(svg?.closest("span")).not.toHaveTextContent(/TT|IG|FB/);
  });

  it("renders the exact Threads brand glyph with the official 192×192 vector", () => {
    const { container } = render(<AccountAvatar platform="threads" name="Studio" />);
    const svg = container.querySelector('svg[data-brand-icon="threads"]');
    expect(svg).toHaveAttribute("viewBox", "0 0 192 192");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg?.closest("span")).toHaveClass("bg-[#0A0A0A]");
    expect(svg?.closest("span")).not.toHaveTextContent(/TT|IG|FB/);
  });

  it("layers TikTok cyan, red, and white brand paths", () => {
    const { container } = render(<AccountAvatar platform="tiktok" name="Aki" />);
    const svg = container.querySelector('svg[data-brand-icon="tiktok"]');
    expect(svg?.querySelectorAll("path")).toHaveLength(3);
    expect(svg?.querySelector('path[fill="#25F4EE"]')).toBeInTheDocument();
    expect(svg?.querySelector('path[fill="#FE2C55"]')).toBeInTheDocument();
    expect(svg?.querySelector('path[fill="white"]')).toBeInTheDocument();
  });

  it("replaces a broken remote image with the platform-branded fallback", () => {
    render(<AccountAvatar platform="instagram" src="https://example.com/broken.jpg" name="Studio" />);
    fireEvent.error(screen.getByTestId("avatar-image"));

    expect(screen.queryByTestId("avatar-image")).not.toBeInTheDocument();
    const fallback = screen.getByRole("img", { name: "Studio" });
    expect(fallback).toHaveAttribute("data-platform", "instagram");
    expect(fallback.querySelector('svg[data-brand-icon="instagram"]')).toBeInTheDocument();
  });

  it("attempts a new src when it changes after a failure", () => {
    const { rerender, container } = render(
      <AccountAvatar platform="tiktok" src="https://example.com/broken.jpg" name="Studio" />
    );
    fireEvent.error(screen.getByTestId("avatar-image"));
    expect(screen.queryByTestId("avatar-image")).not.toBeInTheDocument();

    rerender(<AccountAvatar platform="tiktok" src="https://example.com/fresh.jpg" name="Studio" />);
    const image = screen.getByTestId("avatar-image");
    expect(image).toHaveAttribute("data-src", "https://example.com/fresh.jpg");
    expect(container.querySelector('span[data-platform="tiktok"]')).not.toBeInTheDocument();
  });
});

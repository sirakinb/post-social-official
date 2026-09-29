import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TikTokMockup } from "./tiktok-mockup";

const account = { name: "Adzo Boateng", handle: "adzoai" };
const vertical = { fileName: "intro.mp4", mediaType: "video" as const, url: "https://example.com/intro.mp4", width: 768, height: 1344 };

describe("TikTokMockup", () => {
  it("shows the account handle and the caption with hashtags emphasised", () => {
    const { container } = render(<TikTokMockup media={vertical} caption="Hi, I'm Adzo #meetadzo" account={account} showSafeZones={false} />);
    expect(screen.getByTestId("mockup-handle")).toHaveTextContent("@adzoai");
    expect(screen.getByTestId("mockup-caption")).toHaveTextContent("Hi, I'm Adzo #meetadzo");
    expect(container.querySelector('[data-token="hashtag"]')).toHaveTextContent("#meetadzo");
  });

  it("cuts a long caption with 'more', as the feed does", () => {
    render(<TikTokMockup media={vertical} caption={`${"word ".repeat(60)}#end`} account={account} showSafeZones={false} />);
    expect(screen.getByTestId("mockup-caption")).toHaveTextContent(/… more$/);
  });

  it("fills the screen for vertical video and warns about black bars for non-vertical video", () => {
    const { rerender } = render(<TikTokMockup media={vertical} caption="x" account={account} showSafeZones={false} />);
    expect(screen.getByLabelText("Preview of intro.mp4").className).toContain("object-cover");
    expect(screen.queryByTestId("tiktok-aspect-warning")).not.toBeInTheDocument();
    rerender(<TikTokMockup media={{ ...vertical, width: 1090, height: 1096 }} caption="x" account={account} showSafeZones={false} />);
    expect(screen.getByLabelText("Preview of intro.mp4").className).toContain("object-contain");
    expect(screen.getByTestId("tiktok-aspect-warning")).toHaveTextContent(/black bars/);
  });

  it("only draws the safe-zone overlay when asked", () => {
    const { rerender } = render(<TikTokMockup media={vertical} caption="x" account={account} showSafeZones={false} />);
    expect(screen.queryByTestId("tiktok-safe-zones")).not.toBeInTheDocument();
    rerender(<TikTokMockup media={vertical} caption="x" account={account} showSafeZones />);
    expect(screen.getByTestId("tiktok-safe-zones")).toBeInTheDocument();
  });

  it("falls back to the account name without a handle and handles missing media", () => {
    render(<TikTokMockup caption="" account={{ name: "Adzo Boateng" }} showSafeZones={false} />);
    expect(screen.getByTestId("mockup-handle")).toHaveTextContent("Adzo Boateng");
    expect(screen.getByText("No media attached.")).toBeInTheDocument();
    expect(screen.getByTestId("mockup-caption")).toHaveTextContent("No caption.");
  });
});

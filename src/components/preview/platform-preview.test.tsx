import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PlatformPreview, type PreviewChannel } from "./platform-preview";

const media = [{ fileName: "intro.mp4", mediaType: "video" as const, url: "https://example.com/intro.mp4", width: 768, height: 1344 }];
const tiktok = (key: string, name: string, handle: string): PreviewChannel => ({ key, platform: "tiktok", name, handle, tiktokDraft: false });

describe("PlatformPreview", () => {
  it("opens on the TikTok mockup when TikTok is a destination", () => {
    render(<PlatformPreview media={media} caption="Hello #adzo" channels={[tiktok("a", "Adzo Boateng", "adzoai")]} />);
    expect(screen.getByRole("tab", { name: "TikTok" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("tiktok-mockup")).toBeInTheDocument();
    expect(screen.getByTestId("mockup-caption")).toHaveTextContent("Hello #adzo");
  });

  it("switches to the plain media player and back", async () => {
    const user = userEvent.setup();
    render(<PlatformPreview media={media} caption="x" channels={[tiktok("a", "Adzo", "adzoai")]} />);
    await user.click(screen.getByRole("tab", { name: "Media" }));
    expect(screen.queryByTestId("tiktok-mockup")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Preview of intro.mp4")).toHaveAttribute("controls");
    await user.click(screen.getByRole("tab", { name: "TikTok" }));
    expect(screen.getByTestId("tiktok-mockup")).toBeInTheDocument();
  });

  it("toggles the safe-zone overlay from the checkbox", async () => {
    const user = userEvent.setup();
    render(<PlatformPreview media={media} caption="x" channels={[tiktok("a", "Adzo", "adzoai")]} />);
    expect(screen.queryByTestId("tiktok-safe-zones")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("toggle-safe-zones"));
    expect(screen.getByTestId("tiktok-safe-zones")).toBeInTheDocument();
  });

  it("explains that a platform without a mockup shows the plain media", async () => {
    const user = userEvent.setup();
    render(<PlatformPreview media={media} caption="x" channels={[{ key: "i", platform: "instagram", name: "Aki", handle: "sirakinb", tiktokDraft: false }]} />);
    expect(screen.getByRole("tab", { name: "Media" })).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("tab", { name: "Instagram" }));
    expect(screen.getByTestId("no-mockup-note")).toHaveTextContent(/mockup isn.t available yet/i);
    expect(screen.getByLabelText("Preview of intro.mp4")).toBeInTheDocument();
  });

  it("lets you choose which account to preview when a platform has several", async () => {
    const user = userEvent.setup();
    render(<PlatformPreview media={media} caption="x" channels={[tiktok("a", "Adzo Boateng", "adzoai"), tiktok("b", "Aki", "sirakinb")]} />);
    expect(screen.getByTestId("mockup-handle")).toHaveTextContent("@adzoai");
    await user.selectOptions(screen.getByLabelText(/Preview as/i, { selector: "select" }), "b");
    expect(screen.getByTestId("mockup-handle")).toHaveTextContent("@sirakinb");
  });

  it("tells you a TikTok draft's caption will be pasted by hand", () => {
    render(<PlatformPreview media={media} caption="x" channels={[{ ...tiktok("a", "Adzo", "adzoai"), tiktokDraft: true }]} />);
    expect(screen.getByText(/paste the caption in TikTok yourself/i)).toBeInTheDocument();
  });
});

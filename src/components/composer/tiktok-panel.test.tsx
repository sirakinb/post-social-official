import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { TikTokPanel } from "./tiktok-panel";
import { TikTokCreatorInfo, TikTokOptions } from "@/lib/types";

const creatorInfo: TikTokCreatorInfo = {
  creatorId: "creator_1",
  nickname: "Sample Studio",
  privacyLevelOptions: [
    { value: "PUBLIC_TO_EVERYONE", label: "Public" },
    { value: "SELF_ONLY", label: "Only you" },
  ],
  commentAvailable: true,
  duetAvailable: false,
  stitchAvailable: true,
  maxVideoDurationSec: 600,
  canPost: true,
};

const defaultOptions: TikTokOptions = {
  privacyLevel: "",
  commentEnabled: false,
  duetEnabled: false,
  stitchEnabled: false,
  disclosureEnabled: false,
  yourBrandEnabled: false,
  brandedContentEnabled: false,
};

function setup(options = defaultOptions) {
  const onChange = vi.fn();
  const user = userEvent.setup();
  const view = render(
    <TikTokPanel
      creatorInfo={creatorInfo}
      options={options}
      onChange={onChange}
    />
  );
  return { user, onChange, view };
}

describe("TikTokPanel", () => {
  it("shows creator identity", () => {
    setup();
    expect(screen.getByText(/Sample Studio/)).toBeInTheDocument();
  });

  it("has no default privacy selection", () => {
    setup();
    const select = screen.getByTestId("tiktok-privacy") as HTMLSelectElement;
    expect(select.value).toBe("");
  });

  it("populates privacy options from creator_info", () => {
    setup();
    expect(screen.getByRole("option", { name: "Public" })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Only you" })
    ).toBeInTheDocument();
  });

  it("interaction toggles are unchecked by default", () => {
    setup();
    expect(
      (screen.getByTestId("tiktok-comment") as HTMLInputElement).checked
    ).toBe(false);
    expect(
      (screen.getByTestId("tiktok-duet") as HTMLInputElement).checked
    ).toBe(false);
    expect(
      (screen.getByTestId("tiktok-stitch") as HTMLInputElement).checked
    ).toBe(false);
  });

  it("disables unavailable interaction toggles", () => {
    setup();
    expect(screen.getByTestId("tiktok-duet")).toBeDisabled();
  });

  it("sends direct posts by default and offers a draft-to-inbox option", () => {
    setup();
    expect((screen.getByTestId("tiktok-inbox-mode") as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByTestId("tiktok-inbox-note")).not.toBeInTheDocument();
  });

  it("switching to draft upload calls onChange with the inbox delivery mode", async () => {
    const { user, onChange } = setup();
    await user.click(screen.getByTestId("tiktok-inbox-mode"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ deliveryMode: "inbox" }));
  });

  it("hides privacy, interactions and disclosure controls in draft mode and explains what happens", () => {
    setup({ ...defaultOptions, deliveryMode: "inbox" });
    expect(screen.queryByTestId("tiktok-privacy")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tiktok-comment")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tiktok-disclosure")).not.toBeInTheDocument();
    expect(screen.getByTestId("tiktok-inbox-note")).toHaveTextContent(/caption/i);
    expect((screen.getByTestId("tiktok-inbox-mode") as HTMLInputElement).checked).toBe(true);
  });

  it("selecting privacy calls onChange", async () => {
    const { user, onChange } = setup();
    await user.selectOptions(screen.getByTestId("tiktok-privacy"), "Public");
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ privacyLevel: "PUBLIC_TO_EVERYONE" })
    );
  });

  it("toggles comment on", async () => {
    const { user, onChange } = setup();
    await user.click(screen.getByTestId("tiktok-comment"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ commentEnabled: true })
    );
  });

  it("shows the music usage confirmation language", () => {
    setup();
    expect(
      screen.getByText(/By posting, you agree to TikTok's Music Usage Confirmation./)
    ).toBeInTheDocument();
  });
});

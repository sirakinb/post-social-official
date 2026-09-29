import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Composer } from "./composer";
import type { LibraryAsset, TikTokCreatorInfo } from "@/lib/types";

const creator: TikTokCreatorInfo = {
  creatorId: "creator_1",
  nickname: "Sample Studio",
  privacyLevelOptions: [],
  commentAvailable: false,
  duetAvailable: false,
  stitchAvailable: false,
  maxVideoDurationSec: 60,
  canPost: false,
};

function libraryAsset(overrides?: Partial<LibraryAsset>): LibraryAsset {
  return {
    id: "asset_1",
    fileName: "photo.jpg",
    mimeType: "image/jpeg",
    mediaType: "image",
    sizeBytes: 1000,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Composer library delete", () => {
  it("renders delete controls when callback is supplied", () => {
    render(
      <Composer
        accounts={[]}
        tiktokCreatorInfo={creator}
        libraryAssets={[libraryAsset()]}
        onDeleteLibraryAsset={vi.fn()}
      />
    );

    expect(
      screen.getByRole("button", { name: "Delete photo.jpg from library" })
    ).toBeInTheDocument();
  });

  it("does not render delete controls when callback is omitted", () => {
    render(
      <Composer accounts={[]} tiktokCreatorInfo={creator} libraryAssets={[libraryAsset()]} />
    );

    expect(
      screen.queryByRole("button", { name: "Delete photo.jpg from library" })
    ).not.toBeInTheDocument();
  });

  it("invokes delete callback with the correct asset on confirmation", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn().mockResolvedValue(true);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(
      <Composer
        accounts={[]}
        tiktokCreatorInfo={creator}
        libraryAssets={[libraryAsset()]}
        onDeleteLibraryAsset={onDelete}
      />
    );

    await user.click(
      screen.getByRole("button", { name: "Delete photo.jpg from library" })
    );

    expect(window.confirm).toHaveBeenCalledWith(
      'Remove "photo.jpg" from your library? Unused files will be permanently deleted. Existing posts will be preserved.'
    );
    expect(onDelete).toHaveBeenCalledWith(libraryAsset());
  });

  it("does not invoke callback when confirmation is canceled", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(false);

    render(
      <Composer
        accounts={[]}
        tiktokCreatorInfo={creator}
        libraryAssets={[libraryAsset()]}
        onDeleteLibraryAsset={onDelete}
      />
    );

    await user.click(
      screen.getByRole("button", { name: "Delete photo.jpg from library" })
    );

    expect(onDelete).not.toHaveBeenCalled();
  });

  it("removes selected asset from selection when deletion succeeds", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn().mockResolvedValue(true);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(
      <Composer
        accounts={[]}
        tiktokCreatorInfo={creator}
        libraryAssets={[libraryAsset()]}
        onDeleteLibraryAsset={onDelete}
      />
    );

    await user.click(screen.getByRole("button", { pressed: false }));
    expect(screen.getByText("1 selected")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Delete photo.jpg from library" })
    );

    expect(screen.getByText("0 selected")).toBeInTheDocument();
    expect(onDelete).toHaveBeenCalledWith(libraryAsset());
  });

  it("keeps selection unchanged when deletion fails", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn().mockResolvedValue(false);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(
      <Composer
        accounts={[]}
        tiktokCreatorInfo={creator}
        libraryAssets={[libraryAsset()]}
        onDeleteLibraryAsset={onDelete}
      />
    );

    await user.click(screen.getByRole("button", { pressed: false }));
    expect(screen.getByText("1 selected")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Delete photo.jpg from library" })
    );

    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });

  it("disables delete control while deletion is running", () => {
    render(
      <Composer
        accounts={[]}
        tiktokCreatorInfo={creator}
        libraryAssets={[libraryAsset()]}
        onDeleteLibraryAsset={vi.fn()}
        deletingLibraryAssetId="asset_1"
      />
    );

    expect(
      screen.getByRole("button", { name: "Delete photo.jpg from library" })
    ).toBeDisabled();
  });
});

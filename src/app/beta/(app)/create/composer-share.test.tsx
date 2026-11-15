import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Composer } from "./composer";

const share = vi.hoisted(() => ({ upload: vi.fn(async () => {}), files: [] as File[], text: "" }));
vi.mock("./actions", () => ({
  callPosts: vi.fn(async () => ({ ok: true, data: { ok: true, problems: [] } })),
  getCreatorInfo: vi.fn(async () => ({ ok: false, error: "none" })),
  getMediaLinks: vi.fn(async () => ({})),
}));
vi.mock("@/lib/share-inbox", () => ({ takeShared: vi.fn(async () => ({ files: share.files, text: share.text })) }));
vi.mock("@/components/beta/use-upload", async (original) => ({
  ...(await original<typeof import("@/components/beta/use-upload")>()),
  useUpload: () => ({ uploads: [], upload: share.upload, dismiss: () => {}, resume: () => {}, watch: () => {}, keepOpen: false }),
}));

const account = { id: "a1", platform: "bluesky" as const, name: "Ada", handle: "ada.bsky.social", avatarUrl: null, captionMax: 300, videoMaxSeconds: null };

describe("files shared into Create", () => {
  beforeEach(() => {
    share.upload.mockClear();
    share.files = [new File([new Uint8Array(2048)], "beach.jpg", { type: "image/jpeg" }), new File([new Uint8Array(10)], "clip.mp4", { type: "video/mp4" })];
    share.text = "A caption from somewhere";
    window.history.replaceState(null, "", "/beta/create?shared=1");
  });

  const open = async () => {
    await act(async () => {
      render(<Composer workspaceId="w1" accounts={[account]} library={[]} editing={null} />);
    });
  };

  it("lists the shared files and uploads nothing until the person confirms", async () => {
    await open();
    expect(screen.getByText(/2 files were shared to Post Social/)).toBeInTheDocument();
    expect(screen.getByText(/beach\.jpg/)).toBeInTheDocument();
    expect(screen.getByText(/clip\.mp4/)).toBeInTheDocument();
    expect(share.upload).not.toHaveBeenCalled();
    expect(screen.queryByDisplayValue("A caption from somewhere")).toBeNull();

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Upload these files" })));
    expect(share.upload).toHaveBeenCalledTimes(2);
    expect(screen.getByDisplayValue("A caption from somewhere")).toBeInTheDocument();
    expect(screen.queryByText(/files were shared/)).toBeNull();
  });

  it("drops the shared files when the person discards them", async () => {
    await open();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Discard" })));
    expect(share.upload).not.toHaveBeenCalled();
    expect(screen.queryByText(/files were shared/)).toBeNull();
  });
});

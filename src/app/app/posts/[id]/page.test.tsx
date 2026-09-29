import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import PostPreviewPage from "./page";

const mocks = vi.hoisted(() => ({
  postId: "post_1",
  post: undefined as unknown,
  accounts: undefined as unknown,
  updateCaption: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useParams: () => ({ id: mocks.postId }) }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock("convex/react", () => ({
  useMutation: vi.fn(() => mocks.updateCaption),
  useQuery: vi.fn((ref: string, args: unknown) => {
    if (args === "skip") return undefined;
    return ref === "posts.getForPreview" ? mocks.post : mocks.accounts;
  }),
}));
vi.mock("@/components/workspace-provider", () => ({
  useWorkspace: () => ({ mode: "live", workspaceId: "ws_1", name: "Test Workspace", approvalPolicy: "confirm_each" }),
}));
vi.mock("../../../../../convex/_generated/api", () => ({ api: { posts: { getForPreview: "posts.getForPreview" }, accounts: { list: "accounts.list" } } }));

const tiktokDraftOptions = {
  kind: "tiktok",
  deliveryMode: "inbox",
  privacyLevel: "SELF_ONLY",
  commentEnabled: true,
  duetEnabled: true,
  stitchEnabled: true,
  disclosureEnabled: false,
  yourBrandEnabled: false,
  brandedContentEnabled: false,
  aiGenerated: true,
  creatorInfoCheckedAt: 0,
  creatorInfoSnapshot: { nickname: "Adzo", maxVideoDurationSec: 3600, canPost: true, privacyLevelOptions: ["SELF_ONLY"] },
};

function scheduledPost(overrides: Record<string, unknown> = {}) {
  return {
    _id: "post_1",
    caption: "Hi, I'm Adzo. #meetadzo",
    status: "scheduled",
    effectiveApprovalPolicy: "confirm_each",
    scheduledAt: Date.UTC(2026, 8, 29, 3, 40),
    media: [{ fileName: "intro.mp4", mediaType: "video", url: "https://example.com/intro.mp4" }],
    destinations: [{ _id: "dest_1", connectedAccountId: "acct_1", platform: "tiktok", status: "scheduled", options: tiktokDraftOptions }],
    ...overrides,
  };
}

describe("PostPreviewPage", () => {
  beforeEach(() => {
    mocks.postId = "post_1";
    mocks.updateCaption = vi.fn().mockResolvedValue({ changed: true, needsReapproval: false });
    mocks.post = scheduledPost();
    mocks.accounts = [{ _id: "acct_1", platform: "tiktok", displayName: "Adzo Boateng", handle: "adzoai" }];
  });

  it("previews a scheduled post: the video, caption, time, account and settings", () => {
    render(<PostPreviewPage />);
    // The mockup asks the browser for the frame at 0.1s so the video shows a picture before it is played.
    expect(screen.getByLabelText("Preview of intro.mp4")).toHaveAttribute("src", "https://example.com/intro.mp4#t=0.1");
    expect(screen.getByTestId("preview-caption")).toHaveTextContent("Hi, I'm Adzo. #meetadzo");
    expect(screen.getByTestId("preview-status")).toHaveTextContent("Scheduled");
    expect(screen.getByTestId("preview-schedule")).toHaveTextContent(/2026/);
    expect(screen.getByText("Adzo Boateng")).toBeInTheDocument();
    expect(screen.getByText(/Draft in your TikTok inbox/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing is published until the scheduled time/)).toBeInTheDocument();
  });

  it("shows the destination's TikTok account in the mockup", () => {
    render(<PostPreviewPage />);
    expect(screen.getByTestId("tiktok-mockup")).toBeInTheDocument();
    expect(screen.getByTestId("mockup-handle")).toHaveTextContent("@adzoai");
  });

  it("tells you a TikTok draft cannot carry the caption", () => {
    render(<PostPreviewPage />);
    expect(screen.getByTestId("preview-draft-note")).toHaveTextContent(/can.t receive a caption/i);
  });

  it("copies the caption to the clipboard", async () => {
    const user = userEvent.setup();
    render(<PostPreviewPage />);
    await user.click(screen.getByRole("button", { name: /Copy caption/i }));
    expect(await navigator.clipboard.readText()).toBe("Hi, I'm Adzo. #meetadzo");
    expect(screen.getByRole("button", { name: /Copied/i })).toBeInTheDocument();
  });

  it("shows channel-specific wording separately from the shared caption", () => {
    mocks.post = scheduledPost({
      destinations: [{ _id: "dest_2", connectedAccountId: "acct_2", platform: "threads", status: "scheduled", options: { kind: "threads", mediaType: "text", text: "A shorter Threads version" } }],
    });
    mocks.accounts = [{ _id: "acct_2", platform: "threads", displayName: "Aki", handle: "sirakinb" }];
    render(<PostPreviewPage />);
    expect(screen.getByText("Threads text")).toBeInTheDocument();
    expect(screen.getByText("A shorter Threads version")).toBeInTheDocument();
  });

  it("does not crash on statuses the badge does not know, such as queued", () => {
    mocks.post = scheduledPost({ status: "approved", destinations: [{ _id: "dest_1", connectedAccountId: "acct_1", platform: "tiktok", status: "queued", options: tiktokDraftOptions }] });
    render(<PostPreviewPage />);
    expect(screen.getByTestId("preview-destination")).toBeInTheDocument();
  });

  it("explains when the media file is gone", () => {
    mocks.post = scheduledPost({ media: [{ fileName: "intro.mp4", mediaType: "video", url: null }] });
    render(<PostPreviewPage />);
    expect(screen.getByText(/no longer available/i)).toBeInTheDocument();
  });

  it("shows a loading state, then a clear message for an unknown post", () => {
    mocks.post = undefined;
    const { unmount } = render(<PostPreviewPage />);
    expect(screen.getByRole("status")).toHaveTextContent(/Loading preview/i);
    unmount();
    mocks.post = null;
    mocks.accounts = [];
    render(<PostPreviewPage />);
    expect(screen.getByText(/couldn.t find that post/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Back to the calendar/i })).toHaveAttribute("href", "/app/calendar");
  });

  describe("editing the caption", () => {
    it("saves the trimmed new caption and confirms it", async () => {
      const user = userEvent.setup();
      render(<PostPreviewPage />);
      await user.click(screen.getByTestId("edit-caption"));
      fireEvent.change(screen.getByTestId("caption-input"), { target: { value: "  A better caption  " } });
      await user.click(screen.getByTestId("save-caption"));
      await waitFor(() => expect(mocks.updateCaption).toHaveBeenCalledWith({ workspaceId: "ws_1", postId: "post_1", caption: "  A better caption  " }));
      expect(await screen.findByRole("status")).toHaveTextContent("Saved.");
      expect(screen.queryByTestId("caption-input")).not.toBeInTheDocument();
    });

    it("warns before saving that an approved post will need approval again, and says so after", async () => {
      mocks.updateCaption = vi.fn().mockResolvedValue({ changed: true, needsReapproval: true });
      const user = userEvent.setup();
      render(<PostPreviewPage />);
      await user.click(screen.getByTestId("edit-caption"));
      expect(screen.getByTestId("reapproval-warning")).toHaveTextContent(/asks for approval again/i);
      fireEvent.change(screen.getByTestId("caption-input"), { target: { value: "New wording" } });
      await user.click(screen.getByTestId("save-caption"));
      expect(await screen.findByRole("status")).toHaveTextContent(/needs approval again/i);
    });

    it("does not warn for an autonomous post, which stays scheduled", async () => {
      mocks.post = scheduledPost({ effectiveApprovalPolicy: "autonomous" });
      const user = userEvent.setup();
      render(<PostPreviewPage />);
      await user.click(screen.getByTestId("edit-caption"));
      expect(screen.queryByTestId("reapproval-warning")).not.toBeInTheDocument();
    });

    it("blocks saving over the TikTok limit and shows the count", async () => {
      const user = userEvent.setup();
      render(<PostPreviewPage />);
      await user.click(screen.getByTestId("edit-caption"));
      fireEvent.change(screen.getByTestId("caption-input"), { target: { value: "a".repeat(2201) } });
      expect(screen.getByTestId("caption-count")).toHaveTextContent("2,201 / 2,200");
      expect(screen.getByTestId("save-caption")).toBeDisabled();
    });

    it("shows the server's message when saving fails and keeps the editor open", async () => {
      mocks.updateCaption = vi.fn().mockRejectedValue(new Error("This post is being sent right now, so its caption can't be changed."));
      const user = userEvent.setup();
      render(<PostPreviewPage />);
      await user.click(screen.getByTestId("edit-caption"));
      fireEvent.change(screen.getByTestId("caption-input"), { target: { value: "Changed" } });
      await user.click(screen.getByTestId("save-caption"));
      expect(await screen.findByRole("alert")).toHaveTextContent(/being sent right now/);
      expect(screen.getByTestId("caption-input")).toBeInTheDocument();
    });

    it("updates the mockup live as you type and reverts on cancel", async () => {
      const user = userEvent.setup();
      render(<PostPreviewPage />);
      expect(screen.getByTestId("mockup-caption")).toHaveTextContent("Hi, I'm Adzo. #meetadzo");
      await user.click(screen.getByTestId("edit-caption"));
      fireEvent.change(screen.getByTestId("caption-input"), { target: { value: "Brand new wording #fresh" } });
      expect(screen.getByTestId("mockup-caption")).toHaveTextContent("Brand new wording #fresh");
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.getByTestId("mockup-caption")).toHaveTextContent("Hi, I'm Adzo. #meetadzo");
    });

    it("cancel leaves the caption untouched", async () => {
      const user = userEvent.setup();
      render(<PostPreviewPage />);
      await user.click(screen.getByTestId("edit-caption"));
      fireEvent.change(screen.getByTestId("caption-input"), { target: { value: "Throwaway" } });
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect(mocks.updateCaption).not.toHaveBeenCalled();
      expect(screen.getByTestId("preview-caption")).toHaveTextContent("Hi, I'm Adzo. #meetadzo");
    });

    it("is read-only once a post is published or sending", () => {
      for (const status of ["published", "processing", "failed", "cancelled"]) {
        mocks.post = scheduledPost({ status });
        const { unmount } = render(<PostPreviewPage />);
        expect(screen.queryByTestId("edit-caption")).not.toBeInTheDocument();
        unmount();
      }
    });
  });
});

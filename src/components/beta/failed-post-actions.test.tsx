import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const retry = vi.fn();
const markPublished = vi.fn();
const refresh = vi.fn();
vi.mock("@/app/beta/(app)/calendar/actions", () => ({ retry: (...a: unknown[]) => retry(...a), markPublished: (...a: unknown[]) => markPublished(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const { FailedPostActions } = await import("./failed-post-actions");

describe("FailedPostActions", () => {
  beforeEach(() => {
    retry.mockReset().mockResolvedValue({ ok: true });
    markPublished.mockReset().mockResolvedValue({ ok: true });
    refresh.mockReset();
  });

  it("retries the failed account and refreshes", async () => {
    render(<FailedPostActions postId="p1" accountId="a1" platform="facebook" mayBeLive={false} />);
    expect(screen.queryByText(/may already be on/)).toBeNull();
    expect(screen.queryByText("Post again anyway")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(retry).toHaveBeenCalledWith("p1", "a1");
  });

  it("asks before marking a post as live", async () => {
    render(<FailedPostActions postId="p1" accountId="a1" platform="tiktok" mayBeLive={false} />);
    fireEvent.click(screen.getByRole("button", { name: "It's live" }));
    expect(markPublished).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm it's live on TikTok" }));
    await waitFor(() => expect(markPublished).toHaveBeenCalledWith("p1", "a1"));
  });

  it("when the post may be live, says Retry checks first and asks twice before posting again", async () => {
    render(<FailedPostActions postId="p1" accountId="a1" platform="facebook" mayBeLive />);
    expect(screen.getByText("This may already be on Facebook. Retry checks there before posting again.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Post again anyway" }));
    expect(retry).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "This may post twice. Post again" }));
    await waitFor(() => expect(retry).toHaveBeenCalledWith("p1", "a1", true));
  });

  it("shows why a retry was refused", async () => {
    retry.mockResolvedValue({ ok: false, error: "Only failed posts can be retried (this one is published)." });
    render(<FailedPostActions postId="p1" accountId="a1" platform="x" mayBeLive={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Only failed posts can be retried (this one is published).");
    expect(refresh).not.toHaveBeenCalled();
  });
});

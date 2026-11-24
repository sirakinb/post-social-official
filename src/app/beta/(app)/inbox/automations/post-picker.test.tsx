import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import type { AutomationPost, automationPosts } from "./actions";
import { PostPicker } from "./post-picker";

vi.mock("./actions", () => ({ automationPosts: vi.fn() }));

const post = (id: string, caption: string, extra: Partial<AutomationPost> = {}): AutomationPost => ({
  platform_post_id: id, caption, published_at: "2026-11-15T12:00:00.000Z", live_url: null, thumbnail_url: null, format: "photo", post_id: null, outside: true, ...extra,
});
type Load = typeof automationPosts;
const page = (posts: AutomationPost[], next: string | null = null, source: "live" | "saved" = "live") => ({ ok: true as const, data: { posts, next_cursor: next, source } });

function Harness(props: { load: Load; start?: string; accountId?: string }) {
  const [value, setValue] = useState(props.start ?? "");
  const [one, setOne] = useState(Boolean(props.start));
  return (
    <>
      <PostPicker workspaceId="w" accountId={props.accountId ?? "a"} platform="instagram" onePost={one} onOnePost={setOne} value={value} onChange={setValue} loadPosts={props.load} />
      <output data-testid="value">{value}</output>
    </>
  );
}

describe("PostPicker", () => {
  it("starts on Every post and lists the account's posts once One post is chosen", async () => {
    const load = vi.fn(async () => page([post("1", "Made in Instagram"), post("2", "Sent from Post Social", { outside: false, format: "video" })])) as unknown as Load;
    render(<Harness load={load} />);
    expect(screen.getByRole("radio", { name: "Every post" })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: "One post" }));
    const row = await screen.findByRole("radio", { name: /Made in Instagram/ });
    expect(screen.getByRole("radio", { name: /Sent from Post Social, Nov 15 · Video/ })).toBeInTheDocument();
    await userEvent.click(row);
    expect(screen.getByTestId("value")).toHaveTextContent("1");
    expect(row).toBeChecked();
    expect(screen.getByText(/straight from Instagram, including ones made outside Post Social/)).toBeInTheDocument();
  });

  it("loads older posts and clears the pick when switching back to Every post", async () => {
    const load = vi.fn(async (_w: string, _a: string, cursor?: string | null) => (cursor ? page([post("3", "Older post")]) : page([post("1", "Newest post")], "c1"))) as unknown as Load;
    render(<Harness load={load} start="1" />);
    await userEvent.click(await screen.findByRole("button", { name: "Show older posts" }));
    expect(await screen.findByRole("radio", { name: /Older post/ })).toBeInTheDocument();
    expect(load).toHaveBeenLastCalledWith("w", "a", "c1");
    expect(screen.queryByRole("button", { name: "Show older posts" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "Every post" }));
    expect(screen.getByTestId("value")).toHaveTextContent("");
  });

  it("keeps a post that isn't in the list, says when the list is the saved one, and offers a retry on failure", async () => {
    const saved = vi.fn(async () => page([post("9", "On file")], null, "saved")) as unknown as Load;
    const { unmount } = render(<Harness load={saved} start="77" />);
    expect(await screen.findByRole("radio", { name: /The post this automation is on now/ })).toBeChecked();
    expect(screen.getByText(/couldn’t be reached just now/)).toBeInTheDocument();
    unmount();

    const flaky = vi.fn().mockResolvedValueOnce({ ok: false, error: "down" }).mockResolvedValueOnce(page([post("1", "Back again")])) as unknown as Load;
    render(<Harness load={flaky} start="1" />);
    await userEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByRole("radio", { name: /Back again/ })).toBeChecked());
  });
});

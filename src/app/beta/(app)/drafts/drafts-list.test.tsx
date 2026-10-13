import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DraftsList, type DraftItem } from "./drafts-list";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
const deleteDraft = vi.fn(async (_id: string) => ({ ok: true as const }));
vi.mock("./actions", () => ({ deleteDraft: (id: string) => deleteDraft(id) }));

const draft = (id: string, caption: string, extra: Partial<DraftItem> = {}): DraftItem => ({
  id,
  caption,
  plannedAt: null,
  updatedAt: "2026-10-11T10:00:00Z",
  by: { kind: "api_key", name: "Claude Code", text: "Saved by Claude Code via MCP" },
  thumb: null,
  destinations: [{ platform: "x", account: "Defi Papi" }],
  ...extra,
});

describe("DraftsList", () => {
  it("lists each draft with who saved it, opening in the composer", () => {
    render(<DraftsList drafts={[draft("d1", "Launch week"), draft("d2", "")]} canEdit />);
    const items = within(screen.getByRole("list", { name: "Drafts" })).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText("Saved by Claude Code via MCP")).toBeTruthy();
    expect(within(items[0]).getByRole("link")).toHaveAttribute("href", "/beta/create?post=d1");
    expect(within(items[1]).getByText("No caption")).toBeTruthy();
  });

  it("says so when there are none", () => {
    render(<DraftsList drafts={[]} canEdit />);
    expect(screen.getByText(/No drafts/)).toBeTruthy();
  });

  it("shows the planned time when a draft has one", () => {
    render(<DraftsList drafts={[draft("d1", "Later", { plannedAt: "2026-10-20T15:00:00Z" })]} canEdit />);
    expect(screen.getByText(/^For/)).toBeTruthy();
  });

  it("asks before deleting, then deletes and refreshes", async () => {
    render(<DraftsList drafts={[draft("d1", "Launch week")]} canEdit />);
    fireEvent.click(screen.getByRole("button", { name: "Delete draft: Launch week" }));
    expect(deleteDraft).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(deleteDraft).toHaveBeenCalledWith("d1");
  });

  it("shows the reason when a delete fails", async () => {
    deleteDraft.mockResolvedValueOnce({ ok: false, error: "This post is scheduled." } as never);
    render(<DraftsList drafts={[draft("d1", "Launch week")]} canEdit />);
    fireEvent.click(screen.getByRole("button", { name: "Delete draft: Launch week" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This post is scheduled.");
  });

  it("lets reviewers see drafts but not open or delete them", () => {
    render(<DraftsList drafts={[draft("d1", "Launch week")]} canEdit={false} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

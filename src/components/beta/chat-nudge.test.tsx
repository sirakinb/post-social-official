import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatNudge, NUDGE_AFTER_MS, NUDGE_TEXT, nudgeKey } from "./chat-nudge";

const nav = vi.hoisted(() => ({ path: "/beta/accounts", query: "" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.path, useSearchParams: () => new URLSearchParams(nav.query) }));

const shown = () => ((window as unknown as { $crisp: unknown[][] }).$crisp ?? []).filter((c) => c[0] === "do" && c[1] === "message:show");
const props = { userId: "u1", name: "Nia", email: "nia@example.com", noAccounts: true };

describe("ChatNudge", () => {
  beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); (window as unknown as { $crisp: unknown[] }).$crisp = []; nav.path = "/beta/accounts"; nav.query = ""; });
  afterEach(() => vi.useRealTimers());

  it("tells Crisp who is writing", () => {
    render(<ChatNudge {...props} />);
    const crisp = (window as unknown as { $crisp: unknown[][] }).$crisp;
    expect(crisp).toContainEqual(["set", "user:email", ["nia@example.com"]]);
    expect(crisp).toContainEqual(["set", "user:nickname", ["Nia"]]);
  });

  it("offers help after a while on Accounts with nothing connected, once", () => {
    const { unmount } = render(<ChatNudge {...props} />);
    vi.advanceTimersByTime(NUDGE_AFTER_MS - 1000);
    expect(shown()).toHaveLength(0);
    vi.advanceTimersByTime(1000);
    expect(shown()).toEqual([["do", "message:show", ["text", NUDGE_TEXT]]]);
    expect(localStorage.getItem(nudgeKey("u1"))).not.toBeNull();
    unmount();
    render(<ChatNudge {...props} />);
    vi.advanceTimersByTime(NUDGE_AFTER_MS * 2);
    expect(shown()).toHaveLength(1);
  });

  it("offers help straight away when a connection comes back with an error", () => {
    nav.query = "error=Instagram+said+no";
    render(<ChatNudge {...props} />);
    expect(shown()).toHaveLength(1);
  });

  it("stays quiet once an account is connected, or on other pages", () => {
    render(<ChatNudge {...props} noAccounts={false} />);
    nav.path = "/beta/create";
    render(<ChatNudge {...props} />);
    vi.advanceTimersByTime(NUDGE_AFTER_MS * 2);
    expect(shown()).toHaveLength(0);
  });
});

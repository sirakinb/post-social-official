import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutoRefresh, IDLE_AFTER_MS, IDLE_EVERY_MS, PAUSE_AFTER_MS, refreshDue } from "./auto-refresh";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const MINUTE = 60_000;
const show = (state: "visible" | "hidden") => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
};
const wait = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

describe("when the Inbox re-reads itself", () => {
  const at = (now: number, lastActivity: number, lastRefresh: number, visible = true) => refreshDue({ now, lastActivity, lastRefresh, everyMs: 5000, visible });

  it("keeps its pace while someone is using the page", () => {
    expect(at(5000, 0, 0)).toBe(true);
    expect(at(4000, 0, 0)).toBe(false);
    expect(at(4 * MINUTE, 4 * MINUTE - 1000, 4 * MINUTE - 5000)).toBe(true);
  });

  it("slows to once a minute after 5 minutes left alone, and stops after 30", () => {
    expect(at(IDLE_AFTER_MS, 0, IDLE_AFTER_MS - 5000)).toBe(false);
    expect(at(IDLE_AFTER_MS + IDLE_EVERY_MS, 0, IDLE_AFTER_MS)).toBe(true);
    expect(at(PAUSE_AFTER_MS - 1, 0, PAUSE_AFTER_MS - 1 - IDLE_EVERY_MS)).toBe(true);
    expect(at(PAUSE_AFTER_MS, 0, 0)).toBe(false);
    expect(at(8 * 60 * MINUTE, 0, 0)).toBe(false);
  });

  it("never re-reads a tab nobody can see", () => {
    expect(at(5000, 0, 0, false)).toBe(false);
  });

  it("doesn't speed a slower page up while it is left alone", () => {
    expect(refreshDue({ now: IDLE_AFTER_MS + 2 * MINUTE, lastActivity: 0, lastRefresh: IDLE_AFTER_MS, everyMs: 5 * MINUTE, visible: true })).toBe(false);
  });
});

describe("AutoRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    refresh.mockClear();
    show("visible");
  });
  afterEach(() => vi.useRealTimers());

  it("re-reads every few seconds while the person is active", async () => {
    render(<AutoRefresh seconds={10} />);
    await wait(30_000);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("left open and untouched overnight, re-reads about 25 times in all, not thousands", async () => {
    render(<AutoRefresh seconds={10} />);
    await wait(IDLE_AFTER_MS);
    const whileActive = refresh.mock.calls.length;
    expect(whileActive).toBeGreaterThanOrEqual(29);
    await wait(PAUSE_AFTER_MS - IDLE_AFTER_MS);
    const whileIdle = refresh.mock.calls.length - whileActive;
    expect(whileIdle).toBeGreaterThanOrEqual(23);
    expect(whileIdle).toBeLessThanOrEqual(25);
    // The rest of the night: nothing.
    await wait(8 * 60 * MINUTE);
    expect(refresh.mock.calls.length - whileActive - whileIdle).toBe(0);
  });

  it("re-reads at once when the person comes back, and picks its pace up again", async () => {
    render(<AutoRefresh seconds={10} />);
    await wait(2 * 60 * MINUTE);
    refresh.mockClear();
    await act(async () => void fireEvent.pointerDown(window));
    expect(refresh).toHaveBeenCalledTimes(1);
    await wait(30_000);
    expect(refresh).toHaveBeenCalledTimes(4);
  });

  it("doesn't re-read for every move of the mouse while the person is active", async () => {
    render(<AutoRefresh seconds={10} />);
    await wait(4000);
    for (let i = 0; i < 20; i++) fireEvent.pointerMove(window);
    fireEvent.keyDown(window, { key: "a" });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("stays quiet in a hidden tab, and re-reads when the tab is looked at again after a while", async () => {
    render(<AutoRefresh seconds={10} />);
    await act(async () => show("hidden"));
    await wait(10 * MINUTE);
    expect(refresh).not.toHaveBeenCalled();
    await act(async () => show("visible"));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("stops everything when the page is left", async () => {
    const view = render(<AutoRefresh seconds={10} />);
    view.unmount();
    await wait(MINUTE);
    fireEvent.pointerDown(window);
    expect(refresh).not.toHaveBeenCalled();
  });
});

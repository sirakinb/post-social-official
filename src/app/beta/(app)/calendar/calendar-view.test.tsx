import { describe, expect, it, vi } from "vitest";

vi.mock("./actions", () => ({ cancel: vi.fn(), reschedule: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const { monthRange } = await import("./calendar-view");

describe("monthRange", () => {
  it("covers the whole month in Monday-to-Sunday weeks", () => {
    // October 2026 starts on a Thursday and ends on a Saturday.
    const r = monthRange(2026, 9);
    expect(new Date(r.start).getDay()).toBe(1);
    expect(new Date(r.start).getDate()).toBe(28); // Mon Sep 28
    expect(r.days).toBe(35);
    expect(new Date(r.end - 1).getDate()).toBe(1); // through Sun Nov 1
  });

  it("is four weeks when the month fits exactly", () => {
    // February 2027 starts on a Monday and has 28 days.
    const r = monthRange(2027, 1);
    expect(new Date(r.start).getDate()).toBe(1);
    expect(r.days).toBe(28);
  });

  it("rolls past the end of the year", () => {
    const r = monthRange(2026, 12); // January 2027
    expect(new Date(r.start + 7 * 86_400_000).getMonth()).toBe(0);
  });
});

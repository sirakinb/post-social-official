import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CHANGELOG } from "@/lib/changelog";
import ChangelogPage from "./page";

describe("ChangelogPage", () => {
  it("lists every entry under its day, newest first, with its time", () => {
    render(<ChangelogPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Changelog" })).toBeInTheDocument();
    const days = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(days[0]).toBe("October 13, 2026");
    expect(days.at(-1)).toBe("October 4, 2026");
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(CHANGELOG.length);

    const entry = screen.getByRole("heading", { level: 3, name: "Drafts page" }).closest("li")!;
    expect(within(entry).getByText("12:51 AM EDT")).toHaveAttribute("datetime", "2026-10-13T00:51:00-04:00");
  });
});

describe("CHANGELOG", () => {
  it("keeps entries newest first with valid, offset timestamps", () => {
    const times = CHANGELOG.map((e) => Date.parse(e.at));
    expect(times.every((t) => !Number.isNaN(t))).toBe(true);
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    for (const e of CHANGELOG) expect(e.at).toMatch(/[+-]\d\d:\d\d$|Z$/);
  });
});

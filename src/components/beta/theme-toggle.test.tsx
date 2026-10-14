import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { parseTheme, themeCookie } from "@/lib/beta/theme";
import { ThemeToggle } from "./theme-toggle";

afterEach(() => {
  document.cookie = "ps-theme=; path=/; max-age=0";
});

describe("parseTheme", () => {
  it("defaults to dark for anything but light", () => {
    expect(parseTheme(undefined)).toBe("dark");
    expect(parseTheme("")).toBe("dark");
    expect(parseTheme("blue")).toBe("dark");
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("light")).toBe("light");
  });

  it("writes a site-wide cookie that lasts a year", () => {
    expect(themeCookie("light")).toBe("ps-theme=light; path=/; max-age=31536000; samesite=lax");
  });
});

describe("ThemeToggle", () => {
  it("shows the sun in dark mode and switches the page to light", () => {
    render(<div data-theme="dark" data-testid="app"><ThemeToggle initial="dark" /></div>);
    fireEvent.click(screen.getByRole("button", { name: "Switch to light mode" }));
    expect(screen.getByTestId("app")).toHaveAttribute("data-theme", "light");
    expect(document.cookie).toContain("ps-theme=light");
    expect(screen.getByRole("button", { name: "Switch to dark mode" })).toBeInTheDocument();
  });

  it("shows the moon in light mode and switches back to dark", () => {
    render(<div data-theme="light" data-testid="app"><ThemeToggle initial="light" /></div>);
    fireEvent.click(screen.getByRole("button", { name: "Switch to dark mode" }));
    expect(screen.getByTestId("app")).toHaveAttribute("data-theme", "dark");
    expect(document.cookie).toContain("ps-theme=dark");
  });
});

"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { themeCookie, type Theme } from "@/lib/beta/theme";

const Sun = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
  </svg>
);

const Moon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </svg>
);

// A small switch: in dark mode it shows a sun (click for light), in light mode a moon (click for dark).
export function ThemeToggle({ initial }: { initial: Theme }) {
  const [theme, setTheme] = useState<Theme>(initial);
  const ref = useRef<HTMLButtonElement>(null);
  const next: Theme = theme === "dark" ? "light" : "dark";
  const label = `Switch to ${next} mode`;

  function toggle() {
    document.cookie = themeCookie(next);
    ref.current?.closest("[data-theme]")?.setAttribute("data-theme", next);
    setTheme(next);
  }

  return (
    <button
      ref={ref}
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      data-attr="theme-toggle"
      className="relative flex h-7 w-[52px] flex-none rounded-full bg-ps-fg/[0.08] p-[3px] hover:bg-ps-fg/[0.12]"
    >
      <span
        className={cn(
          "flex h-[22px] w-[22px] items-center justify-center rounded-full bg-ps-surface text-ps-text shadow-[0_1px_3px_rgba(0,0,0,0.18)] transition-transform duration-300",
          theme === "dark" ? "translate-x-6" : "translate-x-0",
        )}
      >
        {theme === "dark" ? <Sun /> : <Moon />}
      </span>
    </button>
  );
}

// The signed-in app's colour theme. Dark is the default; the choice lives in a cookie so the
// server renders the right theme on the first paint (no flash of the wrong colours).
export type Theme = "dark" | "light";

export const THEME_COOKIE = "ps-theme";

export function parseTheme(value: string | undefined | null): Theme {
  return value === "light" ? "light" : "dark";
}

// One year, whole site, so every app page reads the same choice.
export function themeCookie(theme: Theme): string {
  return `${THEME_COOKIE}=${theme}; path=/; max-age=31536000; samesite=lax`;
}

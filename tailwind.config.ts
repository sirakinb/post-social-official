import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: "#0C081A",
        "canvas-ivory": "#151027",
        ink: "#F8F6FF",
        "ink-muted": "#AAA3BB",
        "ink-subtle": "#756E89",
        surface: "#1B1531",
        "surface-raised": "#251D43",
        border: "#382D5B",
        "border-strong": "#55427F",
        accent: "#9B6CFF",
        "accent-violet": "#9B6CFF",
        "accent-hover": "#AD86FF",
        "accent-muted": "#3A285D",
        success: "#38E77A",
        "success-bg": "#153A2A",
        warning: "#FFB45B",
        "warning-bg": "#3A291E",
        error: "#FF7777",
        "error-bg": "#3E202B",
        info: "#AD8AFF",
        "info-bg": "#302554",
        // The signed-in app (/beta). Values live in globals.css as CSS variables so the
        // app can switch between dark (default) and light; see [data-theme="light"].
        "ps-ground": "rgb(var(--ps-ground) / <alpha-value>)",
        "ps-sidebar": "rgb(var(--ps-sidebar) / <alpha-value>)",
        "ps-surface": "rgb(var(--ps-surface) / <alpha-value>)",
        "ps-raised": "rgb(var(--ps-raised) / <alpha-value>)",
        "ps-dialog": "rgb(var(--ps-dialog) / <alpha-value>)",
        "ps-segment": "rgb(var(--ps-segment) / <alpha-value>)",
        "ps-weekend": "rgb(var(--ps-weekend) / <alpha-value>)",
        "ps-nav-active": "var(--ps-nav-active)",
        "ps-line": "var(--ps-line)",
        "ps-line-strong": "var(--ps-line-strong)",
        // Hairlines and hover washes: white on dark, ink on light. Use with an alpha (border-ps-fg/[0.08]).
        "ps-fg": "rgb(var(--ps-fg) / <alpha-value>)",
        "ps-text": "rgb(var(--ps-text) / <alpha-value>)",
        "ps-muted": "rgb(var(--ps-muted) / <alpha-value>)",
        "ps-subtle": "rgb(var(--ps-subtle) / <alpha-value>)",
        "ps-plum": "rgb(var(--ps-plum) / <alpha-value>)",
        "ps-plum-hover": "rgb(var(--ps-plum-hover) / <alpha-value>)",
        "ps-plum-soft": "rgb(var(--ps-plum-soft) / <alpha-value>)",
        "ps-live": "rgb(var(--ps-live) / <alpha-value>)",
        "ps-live-text": "rgb(var(--ps-live-text) / <alpha-value>)",
        "ps-attention": "rgb(var(--ps-attention) / <alpha-value>)",
        "ps-attention-text": "rgb(var(--ps-attention-text) / <alpha-value>)",
        "ps-failed": "rgb(var(--ps-failed) / <alpha-value>)",
        "ps-failed-text": "rgb(var(--ps-failed-text) / <alpha-value>)",
      },
      fontFamily: {
        display: ["var(--font-geist-sans)", "Arial", "Helvetica", "system-ui", "sans-serif"],
        sans: ["var(--font-geist-sans)", "Arial", "Helvetica", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "monospace"],
      },
      boxShadow: {
        hairline: "0 0 0 1px rgba(0,0,0,0.04)",
        soft: "0 16px 48px rgba(3,1,12,0.32)",
        "ps-card": "var(--ps-card-shadow)",
        "ps-nav": "var(--ps-nav-active-shadow)",
      },
      borderRadius: {
        page: "0.5rem",
      },
    },
  },
  plugins: [],
};

export default config;

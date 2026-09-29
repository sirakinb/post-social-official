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
      },
      fontFamily: {
        display: ["var(--font-geist-sans)", "Arial", "Helvetica", "system-ui", "sans-serif"],
        sans: ["var(--font-geist-sans)", "Arial", "Helvetica", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "monospace"],
      },
      boxShadow: {
        hairline: "0 0 0 1px rgba(0,0,0,0.04)",
        soft: "0 16px 48px rgba(3,1,12,0.32)",
      },
      borderRadius: {
        page: "0.5rem",
      },
    },
  },
  plugins: [],
};

export default config;

---
name: light-mode-directions
description: Light mode (2026-10-14) - six directions canvas, Aki picked Soft cards, PR 47 merged and live in prod 2026-10-14, Aligno card completed
metadata:
  type: project
  modified: 2026-10-14T03:38:57.371Z
---

Aligno card "Redesign the Connections page and add a light mode" (id 70998b01…) moved to In Progress by Aki 2026-10-14; Claude claimed it. Aki: Accounts page structure stays; wants light mode with a sun/moon toggle (sun shown in dark mode, moon in light) and six directions to compare, researched via the Mobbin connector (connected 2026-10-14; Mobbin tools only appear in a thread after Aki posts there).

Canvas: https://claude.ai/artifact/S3SXWBtvMHJcdeNNAoGQbE (each board has a working toggle). Directions: 1 Inset panel (Linear), 2 Monochrome (Vercel), 3 Lavender tint (Mercury/Stripe), 4 Ledger (militant: square, mono uppercase labels, ink-black selection), 5 Dark rail (sidebar stays dark; HubSpot/HoneyBook), 6 Soft cards (Apple/Klaviyo). Claude recommended 1, with 4 as the bold option.

2026-10-14: Aki picked 6 Soft cards (wants real platform logos, not letters). Built in PR 47 (branch claude/project-thread-n13i2o): ps-* colors are CSS variables in globals.css, [data-theme="light"] on the app wrapper, ps-theme cookie read by the (app) layout, sun/moon switch at the top right above every page (Aki asked to move it from the sidebar), TikTok logo uses currentColor so it shows on light tiles, ps-fg token replaces white overlays. Aligno card moved to review. PR 47 merged 2026-10-14 03:51 UTC on Aki's word (changelog time 2026-10-13T23:55-04:00); deployed to prod by Claude via the Vercel API 2026-10-14 ~05:25 UTC; Aligno card completed.

Implementation notes (pre-build): app colors are mostly the ps-* Tailwind tokens (tailwind.config.ts), so light mode = turn them into CSS variables swapped by a data-theme attribute. ~90 hardcoded white/[x] overlays and ~20 files with raw hex (e.g. #FF8A8E, #F5D49A, [color-scheme:dark]) need converting. No PR until Aki picks. Related: [[aki-design-taste]], [[ui-pass-profiles-pr28]].

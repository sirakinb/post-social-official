# Phase 6 design direction (2026-10-05)

Mockups: https://claude.ai/artifact/BZiusE4NvWbRP3oPMAjG1j (Home, Create, Calendar, Media,
Accounts & AI, Usage; clickable). Research: Mobbin, four areas, ~40 searches.

## The idea

A calm control room for what your AIs do. The person directs their AI in Claude or
ChatGPT; the web app shows what's coming up, what went live, what needs attention, and
where everything is connected. Dense, quiet, precise: Linear, Vercel, Resend, Raycast.

## Visual system

- Ground `#0B0816`, surface `#120E20`, raised `#1A1430`, sidebar `#0E0A1B`; borders
  white at 6–12%. Text `#F4F1FB`, muted `#A39CB5`, subtle `#6E6784`.
- One accent: plum `#9B6CFF`, used for the one primary button per view, focus, selected
  state and "scheduled". Status: green `#3DD68C` live, amber `#F5B54A` attention/inbox,
  red `#F2555A` failed. Status is a 6 px dot + word; only Failed gets a tinted pill.
- Geist (UI, 13 px base), Geist Mono for times, numbers, IDs, handles, sizes and the small
  uppercase labels (10.5 px, 0.14em tracking). Page titles 18 px / 500, never a hero.
- The 48 px plum technical grid only behind headers, the preview stage and empty states,
  never behind tables. Cards: 1 px border, 12 px radius, one step above the ground.
- Platform marks stay monochrome (the real logos from `src/components/platform-logos`).

## Screens and the patterns behind them

- **Shell:** 240 px sidebar: workspace switcher, ⌘K search, Home · Create · Calendar ·
  Media · Activity, then Connect: Accounts & AI · Usage; plan meter card; user menu at the
  bottom. Active item: plum tint + 2 px inset bar. (Railway, Mintlify, Resend)
- **Home:** greeting + one status sentence; Up next | Needs attention; Activity written as
  sentences ("Claude scheduled a carousel for Instagram via MCP"), grouped by day,
  filter by who (Claude / ChatGPT / Claude Code / You). First run: a 3-step setup
  checklist (connect an account → connect your AI → ask it to post). (Linear, Vercel
  deployments, Mintlify, Better Stack, PlanetScale audit log)
- **Create:** full page split: editor left (account chips, All + per-platform caption tabs
  with customized/problem dots, per-platform limit chips, media tray, platform options),
  sticky phone preview right on the grid with a platform switcher. Footer split button
  "Schedule · Tue 9:00 AM" that names what blocks it. (Buffer, TikTok Studio, Klaviyo,
  Later, Typefully, Linktree)
- **Calendar:** 2 weeks by default (Week / 2 weeks / List), compact chips (status bar,
  platform mark, mono time, thumbnail), drafts dashed, click → small card with Open /
  Move / Cancel; list = agenda grouped by day. Later: drag to reschedule with undo, series
  linking. (Buffer dark calendar, Todoist, Assembly, Sweatpals, Jobber)
- **Media:** grid with true-aspect thumbnails, mono meta line, status only when not ready
  (checking %, not supported), right detail panel with what it fits and where it's used.
  (Frame.io, Air, Artlist)
- **Accounts & AI:** attention banner; social accounts with health + the one right action;
  AI apps as expandable rows (what it can / can't do, disconnect); API keys with prefix
  chips, live/test, last used; "Connect an AI" card with client tabs and copyable setup.
  (Mintlify integrations, Discord authorized apps, Replit MCP, Resend onboarding, WorkOS)
- **Usage:** limit meters (plum → amber 70% → red 100%), period totals, daily chart, By
  account / By AI connection table. (Supabase, OpenAI, Vercel usage)
- **Stats** (when switched on): KPI tabs driving one plum area chart, per-platform totals,
  sortable post table. (Featurebase, Arcade, Later)

## Avoid

Gamified KPIs and streaks, donut charts, big greeting heroes, bright brand-colored
buttons, pastel filled calendar chips, illustration-heavy empty states, raw audit tables,
always-visible red delete buttons, disabled buttons with no reason.

## Real imagery (owner, 2026-10-05)

Everything shows the real thing, never letters or gradients:
- **AI apps:** the actual Claude and ChatGPT marks (Claude Code uses Claude's), picked from
  the signed-in app's name; Cursor and others get their own marks as they appear. API keys
  show a key icon with the name the person gave it.
- **Social accounts:** the profile photo each platform returns at sign-in
  (`connected_accounts.avatar_url`), with the platform's real logo as a small corner badge.
  YouTube can't return a photo with the upload-only permission, so it shows the YouTube
  logo until `youtube.readonly` is approved.
- **People:** their profile photo (add an upload in Settings), initials only as a fallback.
- **Media and posts:** images show themselves; videos show a frame from the video. That
  needs a new worker step: extract a poster frame (ffmpeg in the worker container) when a
  video is checked, store it next to the file, and use it in Media, Calendar, Home and the
  composer.

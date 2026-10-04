# Post Social: InsForge migration and agent-first rebuild

Status: planned (2026-09-30). Owner: Aki. Build: Claude.

## What Post Social is

Social media management for the agent age: the agent version of Buffer or Later.
Post Social is not an agent itself. It is the connection between any AI (ChatGPT,
Claude, Meta AI, Cursor, scripts) and a person's social accounts, plus the engine
that validates, schedules and publishes.

## Principles

1. **API and MCP first.** Every capability is built as an API and MCP tool before any screen.
2. **Full parity, or more, in the AI.** Anything you can do in the web app you can do by
   prompting your AI. The only exception is connecting social accounts, which happens in
   the web app because the platforms require the person to sign in on their own screens
   (the AI can hand over a connect link).
3. **The web app is secondary.** It is a visual client of the same API, for people who want
   a traditional view of what is going on. Nothing exists only in the web app.
4. **Know who did what.** Every action records which connection did it (for example
   "Claude, Aki's connection", "ChatGPT, Pentridge team", "Zapier key", "you in the web app").
5. **Safe by default.** Approval rules per account and per AI, no duplicate posts on retries,
   sensitive actions confirmed by the person, platform consent rules respected.

## Architecture

```
ChatGPT / Claude / Meta AI / any MCP client ─┐
Developers (REST API, API keys) ─────────────┼─► Post Social API + remote MCP server
Web app on Vercel (secondary) ───────────────┘        (InsForge functions)
                                                              │
InsForge: Postgres + row-level security, Auth (Post Social    │
users), Realtime, Schedules, Functions                        │
                                                              ▼
Publishing worker (InsForge Compute, Node container): due-post queue, retries,
token refresh, large uploads, status polling
                                                              │
Cloudflare R2 (media at media.postsocial.xyz): browser uploads directly,
platforms fetch media by URL
```

- **Why a separate worker:** InsForge functions run on Deno and their docs give no execution
  time limit. Long jobs (YouTube uploads, chunked TikTok uploads) and the always-on scheduler
  run in a container that can reuse the existing Node code.
- **Why R2:** the app is video-heavy (up to 1 GB). R2 does not charge for downloads (confirm
  current Cloudflare pricing), and Instagram, Threads, Facebook and TikTok (after domain
  verification) pull media by URL, so our servers never relay gigabytes. InsForge storage only
  for small files, if at all.
- **Two kinds of login:** InsForge Auth signs people into Post Social (adds password reset).
  Social connections (Instagram, TikTok and so on) stay as our own OAuth flows with encrypted
  tokens.

## Environments

| | Prod | Dev |
|---|---|---|
| InsForge | parent project | long-lived `dev` branch |
| Vercel | Production | Preview |
| TikTok | live app keys | sandbox keys in the same app |
| Meta, Google | live apps | same apps, dev callback addresses added alongside prod |

- Schema changes are SQL migration files in git. Try on dev, `branch merge --dry-run` to
  review, then merge to prod. Functions and the worker are deployed to each environment
  separately (branches do not carry code).
- Test on dev with private or test social accounts: dev uses the real apps and shares their
  rate limits.

## Agent tool set (MCP and REST)

Connections and setup: list connected accounts with each account's capabilities (caption
limits, video length, post types); create a connect link; disconnect; list, name and revoke
AI connections and API keys.

Content: import media from a URL or get an upload link; create and edit drafts with
per-platform options; validate before publishing (plain-language problems per platform);
preview link for every draft (the web app mockups).

Publishing: publish now, schedule, reschedule, cancel; results with live links.

Approvals: list what is waiting; approve, edit and approve, or reject.

Audit: activity history filterable by AI, account, platform and outcome.

Rules: per account and per AI (autonomous or approve first, draft-only AIs, daily caps,
quiet hours); optional "approvals only in the web app" for high-stakes accounts.

Sensitive tools (turning off approvals, creating keys, disconnecting) are marked so AI
clients ask the person to confirm.

## Phases (each ends with a check only Aki can do)

0. **Setup:** InsForge project and dev branch, R2 bucket and domain, Vercel environments,
   checks on every change. Done when the dev environment is reachable.
1. **Database and login:** port the 18 tables to Postgres with row-level security, add
   "who did what", duplicate-prevention keys, API clients and usage tracking. InsForge Auth.
   Done when Aki can sign in on dev.
2. **Media:** direct browser-to-R2 uploads, import from URL, media library. Done when a
   500 MB video uploads.
3. **Connections:** Instagram, Facebook Pages, Threads, YouTube, TikTok; token refresh;
   disconnect and revoke; Meta data-deletion and deauthorize endpoints. Done when each
   connects on dev.
4. **Publishing engine:** queue, scheduling, approvals, retries without duplicates; all current
   post types plus **Facebook Reels and Page video** and **Threads video and carousels**;
   TikTok direct post and drafts; caption editing. Done when a real post goes out on every
   platform and a scheduled post fires on time.
5. **Agent layer:** versioned REST API with a published spec, remote MCP server, OAuth sign-in
   plus API keys, the full tool set above, rate limits per AI, usage tracking, docs (API
   reference, setup guides, machine-readable docs). Done when Aki can do everything from
   Claude, including approvals, audit and rules.
6. **Web app:** rebuilt on the same API around Set up, Approve, Audit and Rules; keep previews
   and mockups; live status; port the existing test suite.
7. **Hardening:** logs and alerts, backups, rate limits, security review, upload stress test.
8. **Launch:** promote to prod, add prod callback addresses (Claude can do this in the browser
   with Aki's OK on each save; TikTok last, after its audit), recreate Aki's login and the
   reviewer login, reconnect accounts, smoke test, switch Vercel. Convex stays as a fallback
   for two weeks. Launch waits for the TikTok Direct Post audit (submitted 2026-09-29).

There are no real users yet, so there is no user data to migrate.

## Phase 2 (after launch): native listings

ChatGPT plugin, Claude connector directory, Meta AI connector (Developer Preview: apply for
early access now, they accept an API in active development), then Gemini, Perplexity and
others. All of them build on the same remote MCP server and OAuth from Phase 1. Then new
platforms: X, Bluesky, LinkedIn (approved).

## Decisions

- Made: InsForge for database, auth, functions, realtime and schedules; worker on InsForge
  Compute; no separate test apps; accounts connected in the web app; full AI parity; OAuth
  plus API keys from the start; native listings in Phase 2.
- Defaults unless changed: Cloudflare R2 for media (Aki needs a Cloudflare account by
  Phase 2); agent posts to TikTok need a person's confirmation until TikTok's guidelines are
  checked.

## To verify before or during the build

- InsForge function time limits and Compute pricing; InsForge plan cost of a long-lived branch.
- Cloudflare R2 pricing and TikTok domain verification for `media.postsocial.xyz`.
- Whether TikTok's consent rule can be met inside an AI chat or needs our own interface.
- ChatGPT plugin and Claude directory auth and review requirements (Phase 2).
- Meta approvals for `pages_manage_posts` and `threads_content_publish` in the app dashboards.
- Whether existing encrypted social tokens are worth carrying over (likely just reconnect).

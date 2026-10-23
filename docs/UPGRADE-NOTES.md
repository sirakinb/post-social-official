# Docs upgrade notes

Branch: `dev`. Preview only; not merged and not deployed. Compares the docs as they were at commit a8b928f (one long `/docs` page, `/docs/billing`, `/docs/quickstart`) with the new docs shell.

## What changed

- **One shell for every docs page** (`src/app/docs/layout.tsx`, `src/components/docs/docs-shell.tsx`): top bar with the Post Social wordmark, search and the start button; a left sidebar in eight groups; an "On this page" list on wide screens (read from each page's headings); previous and next links at the bottom; on phones the sidebar opens from a menu button and search sits at the top of it.
- **The old `/docs` page was split**, with its wording kept as it was:
  - Connect an AI and Good to know moved to `/docs/connect`.
  - Command line moved to `/docs/cli`.
  - REST API moved to `/docs/api`.
  - Tools moved to `/docs/tools`.
  - `/docs` is now a landing page: the original intro paragraph plus cards for each section.
- **Old anchors still work.** Opening `/docs#connect`, `/docs#cli`, `/docs#api` or `/docs#tools` forwards to the new page (`src/app/docs/legacy-anchors.tsx`, since a `#` part never reaches the server). `/docs/billing` and `/docs/quickstart` keep their URLs and their `#` anchors. No URL was removed.
- **`/docs/billing`**: only the page frame was removed (its own header and background). Pricing, billing and enterprise wording is untouched.
- **`/docs/quickstart`**: frame removed the same way, and its two links to `/docs#connect` and `/docs#tools` now point at `/docs/connect` and `/docs/tools`.
- **New pages checked against the code**: Concepts and Platforms (see below).
- **Placeholder pages** with clearly marked "Coming soon" blocks: see the last section.
- **`next.config.ts`**: `*.instabox.tech` added to `allowedDevOrigins`. Without it, the dev preview address cannot load the page scripts, so search, the menu and the on-this-page list do nothing there. It has no effect on production builds.

## URL map

| URL | Status |
| --- | --- |
| `/docs` | Landing page with cards (was the long page) |
| `/docs/quickstart` | Existing, in the new shell |
| `/docs/concepts` | New, verified |
| `/docs/connect` | Moved from `/docs#connect` |
| `/docs/safety` | New, partly placeholder |
| `/docs/platforms` | New, verified limits, quirks placeholder |
| `/docs/guides` | New, placeholder (Recipes) |
| `/docs/troubleshooting` | New, short page plus placeholder |
| `/docs/cli` | Moved from `/docs#cli` |
| `/docs/api` | Moved from `/docs#api` |
| `/docs/tools` | Moved from `/docs#tools` |
| `/docs/limits` | New, placeholder (Rate limits and status) |
| `/docs/billing` | Existing, in the new shell |

The sidebar, search, and previous/next order all come from one list: `src/lib/docs-nav.ts`. Search matches page titles, descriptions and keywords, not the full text of each page.

## What was checked against the code

- **Concepts**: workspace and roles (database schema), profile limits (`profiles.ts`: 60-character name, 280-character description, up to 50 profiles), accounts (up to 20 accounts, 35 media files and a 10,000-character caption per post, from `publishing/service.ts`), post statuses (database schema and `operations.ts`, including that `partially_published` means some accounts published and some failed), test and live keys (`operations.ts`, `keys.ts`: up to 50 active keys, owners and admins only).
- **Platforms**: post types from `platforms.ts` and limits from `validate.ts`, the checks Post Social runs before sending.

## Fixed after review (same branch)

- **X price in what AIs read**: the X notes in `operations.ts` and `platforms.ts` said about 1.5 cents and 20 cents, which is Post Social's own cost. They now say 2 cents, or 25 cents with a link, taken from `X_PRICES` so they can't drift. Accounts that were connected before this change keep the old note in their saved capabilities until a migration or reconnect refreshes it.
- **MCP instructions** (`backend/lib/api/mcp.ts`): now list all eight platforms, say TikTok goes direct with the audience the person chose (or to the inbox if the account is set to inbox first), and tell the AI how to check with the person before publishing.
- **Price tiers**: `/docs/billing` now lists 1–2 free, 3–10 at $5, 11–100 at $2.50 and 101+ at $1, and `/llms.txt` says the same. The $10 credit paragraph and worked examples are unchanged. The "more than 2,000 accounts" support line is unchanged.
- **Approvals**: Concepts and Permissions and safety describe the draft-first way of checking with your AI, verified in `operations.ts`, and say an AI cannot approve a post itself. Holding every AI post for approval is deliberately not a feature, so the docs don't mention it.
- **Rate limits** (`/docs/limits`): request limits from `rate-limit.ts` and plan limits from the plans migrations.

## Still placeholder or undecided

- **Plan limits are from migrations**: the live plans table could not be read, so the Free and Paid numbers on `/docs/limits` are unconfirmed against production.
- **Status page**: none exists.
- **Per-platform quirks** (Platforms): review status, how long connections last, platform-specific failure reasons.
- **Troubleshooting error reference**: the full list of failure reasons and error codes.
- **Recipes**: not written. Each needs to be tried against the real tools.
- **Screenshots**: the quickstart still has "Screenshot to add" placeholders.

## Screenshots

In `docs/upgrade-preview/`: `before-*` is the old `/docs` (taken with page scripts off, so the layout is the same but nothing interactive); `after-*` is the new shell. Delete the folder before merging if you don't want images in the repo.

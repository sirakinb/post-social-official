# Architecture

Post Social lets people and their AIs post to social accounts from one place: the web app,
a REST API, an MCP server for AI apps (Claude, ChatGPT, Cursor), and a CLI. All four run
on the same operations, so anything a person can do, an AI can do (approvals and
connecting accounts stay with a person). Environments and promotion: `environments.md`.

```
 People ──► www.postsocial.xyz (Next.js on Vercel)
              │  landing, waitlist, /beta web app, /docs, /llms.txt
              │  rewrites /api/v1, /mcp, /oauth/*, /.well-known/* to the api function
              │
 AIs, CLI ────┤
              ▼
 InsForge (Postgres + Auth + Functions)            Cloudflare R2 (media, private)
   functions: api · posts · media · connections ──► signed upload / view links
   tables with row-level security                    ▲
              ▲                                       │
              │ claims jobs                           │
 Worker (InsForge Compute, always on) ────────────────┘
   publishes posts · checks media · imports links · refreshes tokens · sweeps
              │
              ▼
 Instagram · Facebook Pages · Threads · YouTube · TikTok
```

## Pieces

| Piece | Where | What it does |
|---|---|---|
| Website | `src/app` | Landing and waitlist, legal pages, `/docs` and `/llms.txt` (generated from the operations list), the AI sign-in consent page (`/oauth/authorize`). |
| Web app | `src/app/beta` | Set up (accounts, keys), Create, Calendar, Activity, Media, Stats, Usage. Runs at `/beta`; the old Convex app's addresses (`/app`, `/login`) redirect there. |
| `api` function | `backend/functions/api` | REST `/v1/...`, MCP `/mcp`, OAuth for AI apps, API keys and connected apps, the waitlist, sign-in limit checks. |
| `posts`, `media`, `connections` functions | `backend/functions/*` | The web app's routes: posts, uploads, and connecting social accounts (plus the Meta data-deletion and deauthorize callbacks). |
| Shared logic | `backend/lib` | Everything the functions and worker share: `publishing/` (posts, approvals, checks per platform), `media/`, `connections/` (platform sign-in, encrypted tokens), `oauth/` (our OAuth server), `api/` (operations, REST, MCP, OpenAPI), `rate-limit.ts`, `telemetry.ts`. Runtime-neutral, so it runs in Deno (functions), Node (worker, tests) and later a mobile app. |
| Worker | `worker/` | Node container. Job loops (3 slots) plus timed sweeps; see below. |
| CLI | `cli/` | `postsocial` (npm, not published yet): sign in, post, upload, everything the API offers. |
| Claude Code plugin | `integrations/claude-code` | MCP connection plus a skill (not published yet). |
| Database | `migrations/` | SQL migrations, applied to dev then promoted. |

## Accounts and access

- **Sign-in:** InsForge Auth, email and password. Public sign-up is off; accounts are made
  with `scripts/create-account.ts`. Our website limits sign-in and reset attempts, but
  InsForge's own sign-in has no limit, so this must be fixed before public sign-up.
- **Workspaces:** everything belongs to a workspace. Members are owners, admins, members or reviewers
  (read-only, for platform reviews). Row-level security enforces it in the database.
- **Who did what:** every person, API key and AI app is an *actor*. Posts, approvals,
  uploads and connections record their actor, and `audit_events` keeps the history.
- **AIs:** API keys (`ps_live_…`, `ps_test_…`; test keys can't publish) or OAuth sign-in from
  AI apps (consent page, 1-hour access tokens, rotating refresh tokens). Both are limited per
  key (120/min) and by each plan's daily cap.

## Posting

1. A post has a caption, media and one *destination* per social account, each with its own
   options (e.g. Reel or image). `validate_post` checks every platform's rules first.
2. Approval: each workspace (and each account) is autonomous or needs approval. Agents follow
   it; people approve in the web app. TikTok approved Direct Post (Oct 13, 2026): people
   post directly from the web app, and AI posts to TikTok go out directly too (since Oct 13,
   Aki's call); each direct post must set its audience (`privacy_level`), never assumed. Each
   TikTok account's `tiktok_delivery` (direct by default, or inbox) decides where AI posts go;
   people change it in Accounts, AIs with `set_tiktok_delivery`.
3. Scheduling creates a `publish_job` per destination. The worker claims due jobs, runs the
   platform adapter (`worker/src/publish/*`), saves checkpoints so a retry never posts twice,
   waits for platforms that process in the background, and retries with backoff.
4. Results (live link or a plain-language error) go back to the destination; stats are
   collected afterwards: through the platform's own API for platforms in `ANALYTICS_PLATFORMS`,
   or from the post's public page (ScrapeCreators, `SCRAPECREATORS_API_KEY`) for platforms in
   `ANALYTICS_PUBLIC_PLATFORMS`. Both fill the same rows (`post_metrics.source` says which);
   where both are on, official numbers win, gaps are filled from the public page, and a
   failed official read falls back to it. Follower counts are saved once a day per account
   (`account_follower_days`). Production shows where numbers came from only to the emails in
   the website's `ADMIN_EMAILS`. Once a day (and 10 minutes after each worker start) a stats
   health check (`worker/src/analytics/health.ts`) reads one well-known public profile per
   switched-on platform, looks for a platform where many of every user's recent posts can't
   be read, and warns when ScrapeCreators credits drop below `ALERT_CREDITS_BELOW` (default
   1000). Problems go to the admin only: an error in PostHog and an email to `ALERT_EMAIL`
   (sent through Resend, `RESEND_API_KEY`). Users are never emailed.

Supported now: Instagram (image, Reel, carousel), Facebook Pages (text, link, image, Reel,
video), Threads (text, image, video, carousel), YouTube (video), TikTok (video and photos, posted
directly, or as inbox drafts).

## Media

Browsers and tools upload straight to R2 in parts with signed links (up to 1 GB); links can
also be imported. The worker checks every file (opening bytes first, then mediainfo for
type, size and length), makes a poster frame for videos, and removes files unused for 30
days and files of deleted workspaces.

## Worker

| Job | How often |
|---|---|
| Publish posts (first priority), check and import media | continuously, 3 slots |
| Refresh platform tokens before they expire | every 5 minutes |
| Poster frames | every minute |
| Post stats | every 2 minutes, if switched on |
| Media retention, sign-in leftovers | hourly |
| Files of deleted workspaces | every 6 hours |

Jobs are claimed with a lease. Media leases are short and renewed while running, so a
crashed worker's job is picked up within minutes; publishing leases last 10 minutes and
every write is tied to the claim, so two workers can never send the same post.

## Safety and operations

- **Secrets:** InsForge secrets (functions, worker) and Vercel environment variables (website).
  Platform tokens are encrypted in the database (AES-256-GCM).
- **Rate limits:** per visitor, key, app and person (`backend/lib/rate-limit.ts`), plus per
  social account so we stay inside each platform's limits.
- **Monitoring:** PostHog for errors, post outcomes and alerts; a GitHub Actions uptime check
  every 5 minutes on the site, API and worker.
- **New-user funnel:** five PostHog events, each credited to the person's id (never their
  email): `user_invited` (`npm run beta:invite`), `$identify` (first sign-in in a browser),
  `account_connected` (a new account, not a reconnect), `post_submitted` (scheduled, sent
  now, or sent for approval; `when` says which) and `post_published` (worker).
- **Backups:** prod is backed up automatically before every promotion; `npm run db:backup:prod`
  makes one by hand.
- **Checks:** every change runs typecheck, lint, tests and build in CI; database tests run
  against dev with `npm run test:db`.

## Not built yet

- Webhooks to notify apps (tables exist, no delivery yet).
- LinkedIn, X and Bluesky.
- Publishing the CLI and the Claude Code plugin; listings in AI app directories.
- TikTok Direct Post for AIs (audit to resubmit; see `tasks/tiktok-direct-post-resubmission.md`).

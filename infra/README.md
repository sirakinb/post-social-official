# Infrastructure

What Post Social runs on today. Since 2026-11-26 the backend runs on AWS (account
039612844713, us-east-1); the website stays on Vercel. `docker-compose.yml` here describes
the same services in one file; it is a description, not our deploy path. How we deploy:
`docs/environments.md`. How the code fits together: `docs/architecture.md`.

The AWS setup itself, as code: `infra/aws/` (its README lists every stack and what it costs).

## Services

| Service | Runs on | Size / shape | Code |
|---|---|---|---|
| Website and web app | Vercel (Next.js, Node 24) | Serverless, preview per branch | `src/` |
| API (`api`, `posts`, `media`, `connections` in one Node service) | AWS ECS Fargate, behind one shared load balancer | Prod: 2 containers at `api.postsocial.xyz`. Dev: 1 at `api-dev.postsocial.xyz` | `backend/` |
| Worker | AWS ECS Fargate (Node 24 + ffmpeg) | 1 always-on container per environment, never 2 | `worker/` |
| Database | AWS RDS for PostgreSQL 15 | micro instance per environment, private, encrypted; prod keeps 7 days of automatic backups | `migrations/`, `database/` |
| Sign-in | Our own, inside the API (Better Auth: email and password, Google, emailed codes) | People live in the `auth` schema | `backend/lib/auth/`, `src/lib/sign-in/` |
| Row-level security | Postgres policies using `auth.uid()` | In migrations; the API sets the person per request | `migrations/` |
| Settings and keys | AWS Secrets Manager (`postsocial/<env>/api`, `/worker` and the logins made inside AWS); Vercel for the website | One JSON object per service | names only, below |
| Media storage | Cloudflare R2 (S3 API), private bucket | Signed uploads up to 1 GB | `backend/lib/media/r2.ts` |
| Email | Resend | Transactional and alerts | `backend/lib/` |
| Payments | Stripe | Checkout, subscriptions, webhooks | `backend/lib/billing.ts` |
| Analytics and errors | PostHog | Events, errors, alerts | `backend/lib/telemetry.ts` |
| Nightly backup of prod's database | AWS: a task inside the network, started by AWS at about 3am US Eastern | A dump in our backup bucket, 30 daily and 12 monthly | `infra/aws/lib/backup-stack.ts` |
| Uptime check | AWS, every minute; GitHub Actions a few times a day as a second opinion | Three alarms that email the owner | `infra/aws/lib/uptime-stack.ts`, `.github/workflows/uptime.yml` |
| Dashboard and other alarms | AWS CloudWatch | One overview dashboard (`postsocial-overview`), four alarms for errors, health and the database | `infra/aws/lib/monitoring-stack.ts` |

Two environments, prod and dev, each with its own database, API, worker and settings. They
share the load balancer and the image registry, nothing else.

**InsForge**, where all of this ran until the move, is kept as the way back until about
2026-12-10: prod's database and functions are untouched and idle, and its workers are
deleted. After that it is wound down and its code leaves the repo. Feature-branch previews
of the website still read InsForge dev until then.

## Worker schedule

| Job | How often |
|---|---|
| Publish scheduled posts, check and import media | Continuously, 3 slots |
| Refresh platform tokens | Every 5 minutes |
| Poster frames for videos | Every minute |
| Post stats | Every 2 minutes, when switched on |
| Inbox webhooks and comment automations | Continuously |
| Media retention, sign-in leftovers | Hourly |
| Files of deleted workspaces | Every 6 hours |

Jobs are claimed from Postgres with leases, so the worker needs no separate queue. It writes
a sign of life to the database every half minute, which the uptime check reads through the
API (`/readyz/worker`).

## Addresses registered with outside platforms

These are registered in each platform's developer dashboard. They are on our own domain
(`www.postsocial.xyz`; the website forwards them to the API), so the backend can move
hosts without anything changing for a platform. The full list of paths:
`docs/environments.md`, "Platform addresses on our own domain".

| Platform | What is registered | Points at | Changing it |
|---|---|---|---|
| Meta (Facebook, Instagram, Threads) | OAuth redirect URLs, webhook URL, data-deletion and deauthorize URLs | `www.postsocial.xyz` (`/oauth/.../callback`, `/meta/webhooks`); the data-deletion and deauthorize URLs still hold an old address, to fix at the wind-down | Editable in the dashboard, no review |
| TikTok | Login Kit redirect URIs | `www.postsocial.xyz/oauth/tiktok/callback` (approved Nov 20, 2026) | Needs a TikTok revision review |
| Google (YouTube) | OAuth redirect URI | `postsocial.xyz` | Editable, no review |
| LinkedIn, X | OAuth redirect URLs | `www.postsocial.xyz/oauth/.../callback` | Editable, no review |
| Bluesky | Client id (a URL to our client metadata) | `www.postsocial.xyz/oauth/bluesky/client-metadata.json` | Changing it makes every Bluesky user reconnect |
| Stripe | Webhook endpoint | `www.postsocial.xyz/stripe/webhook` | Editable, no review |

The old InsForge and Convex addresses are still listed beside these in some dashboards;
they are removed at the wind-down.

## Settings (names only)

Values live in AWS Secrets Manager (the backend) and Vercel environment variables (the
website), never in the repo.

- **Platform apps:** `META_APP_ID`, `META_APP_SECRET`, `META_LOGIN_CONFIG_ID`,
  `META_STATS_LOGIN_CONFIG_ID`, `META_INBOX_LOGIN_CONFIG_ID`, `META_WEBHOOK_VERIFY_TOKEN`,
  `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `THREADS_APP_ID`, `THREADS_APP_SECRET`,
  `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REDIRECT_URI`, `GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `LINKEDIN_CLIENT_ID`,
  `LINKEDIN_CLIENT_SECRET`, `LINKEDIN_PAGES_CLIENT_ID`, `LINKEDIN_PAGES_CLIENT_SECRET`,
  `X_CLIENT_ID`, `X_CLIENT_SECRET`, `BLUESKY_CLIENT_JWK`
- **Backend:** `CREDENTIAL_ENCRYPTION_KEY`, `EMAIL_LINK_SECRET`, `CONNECTIONS_PUBLIC_URL`,
  `WEB_APP_HOME`, `WEB_APP_ORIGINS`, `INTERNAL_PROXY_SECRET`. Set on the containers by the
  stack, not kept as settings: the database's address, `DATABASE_PASSWORD`, `AUTH_SECRET`,
  `CONNECTIONS_BASE_URL`, `AUTH_BASE_URL`, `APP_ENV`
- **Storage:** `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
- **Services:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`,
  `ALERT_EMAIL`, `POSTHOG_KEY`, `SCRAPECREATORS_API_KEY`
- **Switches:** `ANALYTICS_PLATFORMS`, `ANALYTICS_PUBLIC_PLATFORMS`, `INBOX_WORKSPACES`,
  `PUBLISH_ALLOWLIST` (dev only), `WORKER_CONCURRENCY`, `MEDIA_RETENTION_DAYS`,
  `LINK_BASE_URL`, `META_WEBHOOK_FORWARD_URL` and `META_WEBHOOK_FORWARD_IDS` (prod only: passes
  our test accounts' Meta webhooks on to dev)
- **Website (Vercel):** `SIGN_IN_URL`, `API_BASE_URL`, `CONNECTIONS_BASE_URL`,
  `FUNCTIONS_BASE_URL`, `INTERNAL_PROXY_SECRET`, `NEXT_PUBLIC_POSTHOG_KEY`,
  `NEXT_PUBLIC_APP_ENV`, `ADMIN_EMAILS`

## Worth knowing if it ever moves again

- **Connected accounts:** platform tokens are encrypted in Postgres with
  `CREDENTIAL_ENCRYPTION_KEY` (AES-256-GCM). Move the key with the data, or every user
  must reconnect every account.
- **Platform approvals** (Meta, TikTok, Google, LinkedIn) belong to our apps on each
  platform, not to the host, so they carry over. The registered addresses are on our own
  domain, so they don't change either.
- **Sign-in** is ours: people, password hashes and sessions are in our own database, so
  they move with it and nobody resets a password.

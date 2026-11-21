# Infrastructure

What Post Social runs on today, for migration planning (InsForge to AWS) and onboarding.
`docker-compose.yml` here describes the same services in one file; it is a description,
not our deploy path. How we deploy today: `docs/environments.md`. How the code fits
together: `docs/architecture.md`.

## Services

| Service | Runs on today | Size / shape | Code | Likely AWS home |
|---|---|---|---|---|
| Website and web app | Vercel (Next.js, Node 24) | Serverless, preview per branch | `src/` | Stay on Vercel, or Amplify / CloudFront + Lambda |
| Database | InsForge managed Postgres 15 | micro instance, ~130 MB data | `migrations/` | RDS for PostgreSQL 15 (or Aurora Serverless v2) |
| Auth | InsForge Auth (email + password, Google sign-in, email codes) | Users live in the `auth` schema | `src/lib/insforge/`, `insforge.toml` | Cognito, or a hosted service (Clerk, Auth0); password hashes need an export plan |
| Row-level security | Postgres policies using `auth.uid()` | In migrations | `migrations/` | Keep in Postgres; set the user id per request |
| Edge functions: `api`, `posts`, `media`, `connections` | InsForge Functions (Deno) | HTTP, short requests | `backend/functions/` | Lambda behind API Gateway, or one small container on ECS Fargate |
| Worker | InsForge Compute (container, Node 24 + ffmpeg) | 1 always-on instance | `worker/` (`worker/Dockerfile`) | ECS Fargate service (1 task) |
| Media storage | Cloudflare R2 (S3 API), private bucket | Signed uploads up to 1 GB | `backend/lib/media/r2.ts` | Can stay on R2; or S3 + CloudFront |
| Email | Resend | Transactional and alerts | `backend/lib/` | Can stay; or SES |
| Payments | Stripe | Checkout, subscriptions, webhooks | `backend/lib/billing.ts` | Stays on Stripe; only the webhook address changes |
| Analytics and errors | PostHog | Events, errors, alerts | `backend/lib/telemetry.ts` | Stays |
| Uptime check | GitHub Actions, every 5 minutes | | `.github/workflows/uptime.yml` | Stays, or CloudWatch Synthetics |

Two environments: prod (`syydd6ck`) and dev (`syydd6ck-zqc`, an InsForge branch with its
own database, functions, worker and secrets).

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

Jobs are claimed from Postgres with leases, so the worker needs no separate queue. On AWS
this stays one Fargate task (or EventBridge Scheduler for the timed sweeps).

## Addresses registered with outside platforms

These are registered in each platform's developer dashboard. Moving them to our own domain
before a migration makes the backend swap invisible to the platforms.

| Platform | What is registered | Points at today | Changing it |
|---|---|---|---|
| Meta (Facebook, Instagram, Threads) | OAuth redirect URLs, webhook URL, data-deletion and deauthorize URLs | InsForge `connections` function | Editable in the dashboard, no review |
| TikTok | Login Kit redirect URIs | Convex forwarder (prod), `www.postsocial.xyz/oauth/tiktok/callback` (approved Nov 20, 2026) | Needs a TikTok revision review |
| Google (YouTube) | OAuth redirect URI | `postsocial.xyz` | Editable, no review |
| LinkedIn, X | OAuth redirect URLs | InsForge `connections` function | Editable, no review |
| Bluesky | Client id (a URL to our client metadata) | InsForge `connections` function | Changing it makes every Bluesky user reconnect |
| Stripe | Webhook endpoint | InsForge `api` function | Editable, no review |

## Settings (names only)

Values live in InsForge secrets and Vercel environment variables, never in the repo.

- **Platform apps:** `META_APP_ID`, `META_APP_SECRET`, `META_LOGIN_CONFIG_ID`,
  `META_STATS_LOGIN_CONFIG_ID`, `META_INBOX_LOGIN_CONFIG_ID`, `META_WEBHOOK_VERIFY_TOKEN`,
  `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `THREADS_APP_ID`, `THREADS_APP_SECRET`,
  `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REDIRECT_URI`, `GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `LINKEDIN_CLIENT_ID`,
  `LINKEDIN_CLIENT_SECRET`, `LINKEDIN_PAGES_CLIENT_ID`, `LINKEDIN_PAGES_CLIENT_SECRET`,
  `X_CLIENT_ID`, `X_CLIENT_SECRET`, `BLUESKY_CLIENT_JWK`
- **Backend:** `INSFORGE_BASE_URL`, `API_KEY`, `ANON_KEY`, `JWT_SECRET` (and JWT key pair),
  `CREDENTIAL_ENCRYPTION_KEY`, `EMAIL_LINK_SECRET`, `CONNECTIONS_BASE_URL`, `WEB_APP_HOME`,
  `WEB_APP_ORIGINS`, `INTERNAL_PROXY_SECRET`, `APP_ENV`
- **Storage:** `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
- **Services:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`,
  `ALERT_EMAIL`, `POSTHOG_KEY`, `SCRAPECREATORS_API_KEY`
- **Switches:** `ANALYTICS_PLATFORMS`, `ANALYTICS_PUBLIC_PLATFORMS`, `INBOX_WORKSPACES`,
  `PUBLISH_ALLOWLIST` (dev only), `WORKER_CONCURRENCY`, `MEDIA_RETENTION_DAYS`,
  `LINK_BASE_URL`, `META_WEBHOOK_FORWARD_URL` and `META_WEBHOOK_FORWARD_IDS` (prod only: passes
  our test accounts' Meta webhooks on to dev)
- **Website (Vercel):** `NEXT_PUBLIC_INSFORGE_URL`, `NEXT_PUBLIC_POSTHOG_KEY`,
  `NEXT_PUBLIC_APP_ENV`, `API_BASE_URL`, `ADMIN_EMAILS`

## Migration notes

- **Connected accounts:** platform tokens are encrypted in Postgres with
  `CREDENTIAL_ENCRYPTION_KEY` (AES-256-GCM). Move the key with the data, or every user
  must reconnect every account.
- **Platform approvals** (Meta, TikTok, Google, LinkedIn) belong to our apps on each
  platform, not to the host, so they carry over. Only the registered addresses above change.
- **Auth** is the largest piece: InsForge issues the sign-in tokens that row-level security
  reads. A new auth provider means new tokens, a new way to set the user id in Postgres,
  and either exported password hashes or a one-time password reset.

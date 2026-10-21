# Claude handoff: moving Post Social to a new Claude account

Written 2026-10-21, the day after open sign-up and billing went live. This is
for Aki and for the Claude on the new account. It collects everything the old
account's Claude knew that isn't obvious from the code, so nobody has to
rediscover it.

**There are no secrets in this file.** It names which keys exist and where
they live. Values stay in InsForge, Vercel, Stripe, and the cloud environment's
network secrets. Never paste a key into this file, into project memory, or into
chat.

Other repo docs to read alongside this one: `AGENTS.md` (shipping rules),
`docs/environments.md` (dev/prod, platform sign-in setup, known limits),
`docs/architecture.md`, `tasks/analytics-permissions.md` (platform approvals).

---

## Day one on the new account

Do these in order. Each step says who does it.

1. **Connect GitHub** on the new account and install the Claude GitHub App on
   `sirakinb/post-social-official`.
2. **Create the project** in the new account with the repo
   `github.com/sirakinb/post-social-official`, and paste the "Project
   instructions" section below into its instructions.
3. **Create the cloud environment** and add its network secrets (see
   "Connections to re-create"). The most important are the Post Social prod
   InsForge key, Vercel, and the Aligno key. Start a fresh session after adding
   them; sessions started earlier don't pick them up.
4. **Reconnect the claude.ai connectors**: Gmail (support@postsocial.xyz lands
   in Aki's Gmail), PostHog, Stripe (live account), Resend, Mobbin (design
   research), Claude Docs. Optional: Post Social's own MCP server.
5. **Approve the Mac folder** `/Users/sirakinb/Documents/Thought-Social` for
   Remote Control / folder access, so Claude can run `test:db`, `db:dev`, etc.
6. **Recreate the six scheduled checks and the hourly Aligno work picker**
   using the prompts in "Scheduled checks" below. Then **turn off the old
   account's copies** so cards aren't filed twice.
7. **Seed project memory**: ask the new Claude to read this file and save the
   key facts into its project memory.
8. **Smoke test**: ask the new Claude to probe the live database read-only
   (`GET https://syydd6ck.us-east.insforge.app/api/database/records/workspaces?select=id&limit=1`
   should return 200), list Aligno tasks, and `GET https://api.vercel.com/v2/user`.

---

## What Post Social is, today

- Social media scheduler with a web app, REST API, and MCP server, so people
  (and their AI agents) can post everywhere from one place.
- Production site: **www.postsocial.xyz**. Changelog: postsocial.xyz/changelog
  (entries in `src/lib/changelog.ts`, newest first, written for customers).
- Eight platforms live since 2026-10-13 (v1): TikTok, Instagram, Facebook
  Pages, Threads, YouTube, LinkedIn, Bluesky, X.
- **Launched 2026-10-21 ~00:51 UTC**: open sign-up and live Stripe billing. The
  waitlist is gone. The "Beta" label stays on purpose for now (Aki's call).
- Sign-up is **email only**. Email verification is ON in prod (6-digit code
  step on sign-in and sign-up, PR 71). The Google button is hidden
  (`GOOGLE_SIGNIN = false` in `src/lib/insforge/auth-rules.ts`) until Post
  Social has its own Google OAuth app; Aki wants the consent screen to say
  "Post Social", not InsForge.
- Sign-in rate limit: 5 tries per email+network per 60 seconds
  (`backend/lib/rate-limit.ts`), live in prod.
- Aki's own test sign-up account (sirakinb@gmail.com, "Aki's workspace") is a
  TEST account. Don't count it as an organic sign-up.

### Owner and people

- Owner: **Aki** (GitHub `sirakinb`), Philadelphia, US Eastern time. Email
  aki.b@pentridgemedia.com. Company: Pentridge Media.
- Beta user: **Emmanuel Jones** (emmanuel@alignworkspace.com). Uses the REST
  API. His workspace stays on the unbilled Tester plan.

---

## Infrastructure map

| Piece | Where | Notes |
|---|---|---|
| Web app | Vercel project `post-social` (`prj_Y1Fyu6SRy4vtGwsZekrqS1EC55R6`, team `team_eEUXbDFXnVAXxi9YfyUl8lym`) | Merging to main never auto-deploys (`vercel.json`). |
| Backend (dev + prod) | InsForge. Prod `syydd6ck.us-east.insforge.app`, functions at `syydd6ck.function2.insforge.app` | Dev and prod are separate projects; see `docs/environments.md`. |
| Publish worker | InsForge Compute, service "post-social-worker" | NOT Fly; the deploy script only borrows Fly's CLI. If it dies, posts stop. |
| Media | Cloudflare R2 buckets `postsocial-media-prod`, `postsocial-media-dev` | Account `5e9cbd18080d4f973442560e2140a3e0` also holds other projects' buckets: ignore them. Free to 10 GB. |
| Email | Resend, domain postsocial.xyz | Sender "Akinyemi <akinyemi@postsocial.xyz>", alerts from alerts@postsocial.xyz. |
| Payments | Stripe live account "Pentridgemedia - Main" | Product "Post Social". |
| Analytics | PostHog project "Post Social" (id 642504) | Masking on. |
| Public stats | ScrapeCreators (prepaid credits) | Used until each platform approves official stats. |
| Tracker | Aligno (alignopm.com), Aki's own PM tool | Aki sometimes says "a lino". |
| Old backend | Convex deployment `vibrant-donkey-218` | Runs only a tiny forwarder for TikTok sign-in and Meta callbacks. Do NOT pause it until Aki registers the InsForge TikTok callback in TikTok's portal. |

**Warning:** `aid258ua.us-west.insforge.app` is **Aligno's** backend with real
client data. It is not Post Social. Never touch it for Post Social work.

---

## Connections to re-create on the new account

Names and locations only. Aki adds every value himself.

### Where every key lives (summary)

| Where | What's there | Moves with the account? |
|---|---|---|
| **InsForge secrets** (dev and prod projects, InsForge dashboard or `scripts/insforge-env.sh`) | Everything the app itself uses: platform app credentials (TikTok, Meta, LinkedIn, X, Bluesky), Resend, Stripe, ScrapeCreators, analytics settings | No action: lives in InsForge, not in Claude |
| **Vercel env vars** (project `post-social`) | Site settings such as `PUBLIC_SIGNUP`, `ADMIN_EMAILS`, public InsForge URLs | No action |
| **Stripe dashboard** | Live secret key and webhook signing secret (copied into InsForge) | No action |
| **Platform developer portals** (TikTok, Meta, LinkedIn, X console, Google) | The source of each app's client id/secret | No action |
| **Claude cloud environment network secrets** | Keys Claude itself uses: Post Social prod InsForge key, Vercel token, Aligno key, Cloudflare R2 read token, ScrapeCreators key | **Re-add on the new account** |
| **claude.ai connectors** | Gmail, PostHog, Stripe, Resend, Mobbin, Claude Docs, GitHub (sign-in, no keys to copy) | **Reconnect on the new account** |
| **Aki's Mac** (`.insforge` login in the repo checkout, Vercel CLI login) | Admin access for `db:promote` and deploys | No action |

Only the network secrets and connectors belong to the old Claude account. Everything the
running product needs stays where it is.

### Cloud environment network secrets (host + injected header)

The cloud environment UI has only "Network secrets", no "allowed domains" box.
A host becomes reachable from cloud sessions once it has a network secret.

| Host | What it is | Notes |
|---|---|---|
| `syydd6ck.us-east.insforge.app` | Post Social **prod** InsForge admin key | Lets checks read the live DB. The key can write: Claude keeps to reads unless Aki asks. |
| `api.vercel.com` (and `vercel.com`) | Vercel token | Used for site deploys from the cloud. |
| `alignopm.com` | Aligno API key (`alg_live_…`, bearer) | Generate one at alignopm.com/settings. |
| `api.cloudflare.com` | Cloudflare **read-only** token (Account Analytics: Read + Workers R2 Storage: Read) | For storage-size checks only. |
| `api.scrapecreators.com` | ScrapeCreators key, header `x-api-key` | For credit-balance checks. |

### claude.ai connectors

Gmail, PostHog, Stripe (point at the live account), Resend, Mobbin, Claude
Docs, GitHub. Optional: Google Drive/Calendar, Post Social's MCP server.

### Secrets that already live in InsForge (don't move, just know they exist)

Per environment (dev and prod): `RESEND_API_KEY`, `LINKEDIN_CLIENT_ID`,
`LINKEDIN_CLIENT_SECRET`, `X_CLIENT_ID`, `X_CLIENT_SECRET`,
`BLUESKY_CLIENT_JWK`, TikTok and Meta app credentials, `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `SCRAPECREATORS_API_KEY`, `ANALYTICS_PLATFORMS`,
`ANALYTICS_PUBLIC_PLATFORMS`, `ALERT_EMAIL`. Dev also has `PUBLISH_ALLOWLIST`
(dev only publishes to accounts on that list; prod has no list).

### Vercel environment variables

`PUBLIC_SIGNUP=on` (prod) is the sign-up switch. `ADMIN_EMAILS` controls who
sees admin-only data columns.

---

## How to ship (deploys and their gotchas)

### Rules

- Merges and prod deploys **always wait for Aki's word in the thread**. Once he
  says "merge and deploy", Claude does the whole rollout wherever connected
  services allow, without asking again.
- Claude may start new sessions/threads to run commands (including on Aki's
  Mac) without asking.
- Check with Aki before pushing. Aki moving an Aligno card to In Progress
  authorizes a PR for it.
- Secrets go into InsForge by Aki, never in files or memory.

### Site deploy from the cloud (Vercel API)

```
POST https://api.vercel.com/v13/deployments?teamId=team_eEUXbDFXnVAXxi9YfyUl8lym
{"name":"post-social","project":"prj_Y1Fyu6SRy4vtGwsZekrqS1EC55R6","target":"production",
 "gitSource":{"type":"github","repoId":1394110583,"ref":"main","sha":"<origin/main sha>"}}
```

Then `GET /v13/deployments/<id>` a few times until `readyState` is READY.
Gotchas:

- The auto-mode safety check sometimes refuses this as "Production Deploy". It
  accepts Aki's approval said in that same thread, not one relayed from
  another thread. Citing his approval message and retrying once has worked.
  "Stage 2 classifier error" refusals are transient: retry.
- A background polling loop was refused; single status GETs are fine.
- Once the POST returned an empty body and created nothing. List deployments
  before retrying so you don't double-deploy.
- Fallback: Aki redeploys main in the Vercel dashboard, or `npm run deploy:prod`
  on his Mac (Claude on the Mac is refused for that command).

### Database and backend (from Aki's Mac, on main)

`db:promote` and prod function/worker deploys run on Aki's Mac. Cloud attempts
were refused by the safety check even with approval. Claude gives Aki **one
batched block** of commands to paste.

Release order for a schema change:

1. `npm run db:dev` (always first: `db:promote` silently skips a migration
   that isn't on dev yet; this bit us on PR 65)
2. `npm run test:db`
3. `npm run db:promote`
4. `npm run functions:deploy prod <fn>` for each changed function
5. worker deploy, if changed
6. `rm -rf dist .next && npm run deploy:prod` (a stale `dist` once broke a deploy), or the Vercel API above

More gotchas:

- Deploy api/worker only **after** promote succeeds. But if a promote re-queues
  rows the worker consumes, deploy the new worker first (or re-queue again
  after).
- `db:promote` backs up prod first. InsForge allows 5 manual backups; when
  full, promote stops. Delete the oldest manual one
  (`scripts/insforge-env.sh prod backups list` / `backups delete <id>`).
  Nightly "scheduled" backups don't count.
- `deploy-function.sh` sometimes prints success and then hangs: Ctrl+C, the
  deploy already went through.
- A 502 "Server Error" from InsForge is transient: retry in 30 seconds.
- Deploying dev from main once left dev's api without billing. Always check out
  the PR branch before a dev deploy.
- Prod commands need the terminal on main.
- If a thread deploys while Aki runs a secrets command, both can fail silently.

### InsForge quirks

- The dashboard secret form splits the value at the first "=". Use
  `scripts/insforge-env.sh <env> secrets add KEY 'value'` instead.
- `secrets update` takes no value: delete, then add.
- Dev functions only read new secrets on (re)deploy or start.
- Cloud writes to prod InsForge secrets are refused by the safety check. Vercel
  env writes work, but `PUBLIC_SIGNUP`-style flags were also refused once as
  "Feature Flag Writes"; Aki set that one.
- Auth diagnosis: `GET /api/auth/config`, `/api/auth/users`, audit log
  `GET /api/logs/audits?module=AUTH`.

---

## Pricing and billing (decided, live)

- Graduated price per connected account per month: **$5** (accounts 1–10),
  **$2.50** (11–100), **$1** (101+). A **$10 monthly credit** covers the first
  2 accounts. Implemented as a Stripe licensed graduated price on subscription
  quantity; Stripe prorates.
- Terms describe a 30-day month with daily proration, and a 30-day notice for
  price changes. **Marketing copy must never say "pay by the day" or mention
  proration.** Lead with: "Your first 2 accounts are free. After that it's
  usage based: you pay per account."
- X posts on top: **$0.02 per post, $0.25 with a link**. Free tier gets $1 of X
  a month. Each customer has a monthly X cap, default $10: in-app warning at
  80% (no email yet), X posting pauses at 100%. Never say "X charges us".
- New sign-ups start on Free (2 accounts); a card is needed beyond that.
  Beta workspaces (Aki, Emmanuel) stay on the unbilled Tester plan (up to 50
  accounts). Aki can ask to move a beta user to Free to start billing them.
- Stripe live: product Post Social, lookup keys `post_social_accounts_monthly`,
  `post_social_x_post`, `post_social_x_link_post` (code uses lookup keys).
  Customer portal cancels at period end. Live webhook →
  `https://syydd6ck.function2.insforge.app/api/stripe/webhook` with 4 events:
  `customer.subscription.created/updated/deleted`, `invoice.created`.
- Usage caps: 3,000 published posts/month/workspace
  (`backend/lib/publishing/service.ts`); 300 posts/day per X account
  (`worker/src/publish/x.ts`). The X developer console spending limit is the
  only real dollar control on our side.
- Billing page design is our own ("Your month", "Your rate", "X spending",
  "Card and receipts", "Cancel paid plan"). Be inspired by Zernio's function,
  never copy its layout or words (Aki objected strongly once).

---

## Platform quirks

- **TikTok**: Direct Post approved 2026-10-13. AI posts go DIRECT by default
  (Aki accepted the re-review risk); each TikTok account has a delivery setting
  (direct / inbox first), also via the `set_tiktok_delivery` tool. The AI picks
  privacy. Video covers must be a video frame (API limit); a carousel's cover is
  its first photo. TikTok's 19-digit post IDs must stay strings end to end (PR
  65 fixed a precision bug). Prod TikTok sign-in still goes through the Convex
  forwarder.
- **X**: one app for dev and prod. It must sit in the "Post Social" (Pay Per
  Use) project in console.x.com or profile reads fail. Our cost is about $0.015
  a post, $0.20 with a link. Auto top-up and a spending limit are set. Aki's
  account is @Defi__Papi.
- **LinkedIn**: client `772hbqs7d0agxw`, scope `w_member_social` (personal
  profiles only). No refresh tokens: users reconnect every 60 days. Company
  Pages would need the Community Management API (not requested). Followers are
  derived from posts (no public count).
- **Bluesky**: no developer app; users sign in on Bluesky's page. Needs
  `BLUESKY_CLIENT_JWK` per environment. Enabled, but no prod account connected
  yet.
- **Instagram / Facebook / Threads**: official stats code is built but
  dev-only until Meta approves. Facebook Reels, LinkedIn, and Bluesky are MP4
  only (iPhone MOV is converted automatically). Any photo is fitted for
  Instagram with a blurred backdrop.
- **YouTube**: will be submitted to Google later, bundled with comment
  permissions.

### Analytics

- Live since 2026-10-17 using public numbers from ScrapeCreators for all
  platforms. Official API stats are built but dev-only pending approvals
  (`tasks/analytics-permissions.md`).
- Approval order: Meta first (code ready, only app review missing), then TikTok,
  then YouTube with comments. LinkedIn, X, Bluesky have nothing to apply for.
- Never show "—" gaps or invent numbers: show only the metrics a platform
  reports.
- The worker runs its own daily stats check (test-reads each platform, flags
  mass failures, stalled stats, missing followers, low ScrapeCreators credits)
  and emails Aki (`ALERT_EMAIL`) plus PostHog.

### Next big direction (Aki, 2026-10-20)

Match Zernio on analytics depth, and build "our version of ManyChat" (comment
keyword → automatic DM), Instagram first. Meta approves comment permissions
only after seeing the feature work, so build comments in dev while the
analytics reviews are out. Phone numbers/SMS are on hold unless users ask.
Plan doc (old account, may not open from the new one):
claude.ai/code/artifact/939f0984-2119-4896-b260-15f20a7010af.

---

## Writing and design rules from Aki

- Plain words everywhere. Say "AI agent", "your agent", or name the app
  (Claude, ChatGPT), never bare "AI".
- UI taste: "organized, structured, militant, simple, minimalistic". No rows of
  wrapping pill chips; one fixed toolbar with dropdowns. Dark mode is default,
  light mode exists.
- Any error a customer can't fix themselves just says to contact support
  (wording in `backend/lib/support.ts`, `worker/src/publish/support.ts`).
- Never invent testimonials, counts, or "featured on" badges.
  Real quotes go in the `TESTIMONIALS` array in `src/app/page.tsx`.
- Every user-facing PR adds a changelog entry.

### Email rules

- cc Aki (aki.b@pentridgemedia.com) on **every** email to a user.
- Every outgoing email uses the welcome email's shell with the banner
  `https://www.postsocial.xyz/email/welcome-banner.jpg` at the top.
- Plain words, a heading and bullets, no long greeting.
- Real outbound sends need Aki's own approval in the thread.
- Beta invite script still exists (`npm run beta:invite -- <env> --email ... --name "..."`)
  but open sign-up is the main door now.

---

## Aligno board and card style

- REST API: `https://alignopm.com/api/v1`, bearer `alg_live_…` key,
  `workspace_id` on every request, `{data}/{error}` envelope, DELETE is a soft
  archive.
- Workspace `da7ee67c-2f6f-4584-abaa-b71567973230`; Post Social project
  `5c2688a6-2748-4f3c-be2d-91ffc9b5218c`.
- Statuses: todo (Inbox/Next/Later), in_progress, review, blocked, completed
  (done is `completed`, not `done`). Call the blocked column **"Blocked"**,
  never "Waiting".
- Labels (project-scoped): Type = Bug, Feedback, Change, Check finding, Chore.
  Severity = "P0 – fix today", "P1 – fix within 2 days", "P2 – next weekly
  batch", "P3 – later, reviewed monthly". Source = "From a user", "From Aki",
  "From a scheduled check", "From PostHog", "From uptime alerts". Look up IDs
  with `GET /labels?workspace_id=…&project_id=…`. Every new card gets one of
  each.
- **Card format** (must be readable by a non-technical person):
  - Title: what changes, everyday words, verb first. No code names, paths,
    acronyms, or PR numbers.
  - Description, in order: "What's going on:", "Why it matters:", "Done when:",
    optional "What Aki needs to do:", then "Technical notes (for Claude):"
    (the only place for jargon), and a final "Board column: …" line.
- Before marking an ops-only card Blocked, check whether it's already done; if
  so, close it as completed with a one-line note.

### Iteration system

- One board, one release path, a Monday review.
- Severity timing: P0 same day, P1 within 2 days.
- Scheduled checks only **file** cards (status todo, "Board column: Inbox"),
  skip anything already open (comment new evidence on the existing card), and
  never fix, merge, deploy, email, or touch prod data or secrets.
- Aki moving a card to In Progress triggers the hourly work picker.

---

## Scheduled checks (recreate on the new account)

All times US Eastern (`CRON_TZ=America/New_York`). On the old account they all
fired into the "Aligno tracker setup" thread, and the picker into the "Aligno
work picker" thread. The prompts refer to shared rules (live-DB read-only rules
and card style above); paste those rules into the new project memory first, or
put them in the prompt.

**Shared read-only database rules for checks:** probe
`GET https://syydd6ck.us-east.insforge.app/api/database/records/workspaces?select=id&limit=1`
each run. 200 = access; proxy 403 = host not allowed; 401/403 from InsForge =
no key. If no access, say so in one line and skip the DB steps. Only HTTP GET on
`/api/database/records/<table>` with PostgREST filters. Never POST/PATCH/DELETE,
SQL, rpc. Never select credential payloads or token columns. No personal data
(emails, captions, names) in cards or digests: counts, platforms, short ids.

| Check | Schedule (cron) |
|---|---|
| Daily health | `56 8 * * *` (every day 8:56am) |
| Weekly security | `55 8 * * 1` (Mon 8:55am) |
| Weekly product | `26 9 * * 1` (Mon 9:26am) |
| Monthly privacy | `55 8 1 * *` (1st, 8:55am) |
| Monthly cost and speed | `21 9 1 * *` (1st, 9:21am) |
| Quarterly | `45 8 1 1,4,7,10 *` (1st of Jan/Apr/Jul/Oct, 8:45am) |
| Aligno work picker | `56 * * * *` (hourly at :56) |

### Daily health check prompt

> Daily health check for Post Social (runs every day, weekends included). Follow the shared rules for scheduled checks and the live-database read-only rules (and the Aligno card style for card format, IDs and labels). Steps:
> 1) Gmail: read the last 24h of mail to support@postsocial.xyz and any uptime-failure or GitHub Actions failure emails for sirakinb/post-social-official. Also note any "Post Social stats" alert email from alerts@postsocial.xyz (the worker's own daily stats check).
> 2) GitHub: check the latest scheduled uptime workflow runs and CI on main.
> 3) PostHog (project "Post Social", 642504, exclude test accounts): count publish_failed vs post_published in the last 24h by platform, plus new $exception errors.
> 4) Live database, strictly read-only: probe https://syydd6ck.us-east.insforge.app/api/database/records/workspaces?select=id&limit=1 (Post Social prod; never aid258ua.us-west.insforge.app, which is Aligno's). If it isn't 200, put one line in the status ("live database not reachable: <proxy blocked / no key / other>") and skip the database parts of steps 4 and 4b. If it is: GET only on /api/database/records/<table>, never write, never select credential payloads or tokens, no personal data in cards. Check publish_jobs stuck (queued/retry_wait with next_attempt_at over 30 min ago, or running with lease_expires_at over 10 min ago), publish_jobs failed in the last 24h grouped by last_error, connected_accounts whose health isn't "connected", and logins expiring within 7 days (credentials.refresh_token_expires_at; for LinkedIn, access_token_expires_at).
> 4b) Analytics, for every user (same read-only rules):
>   - ScrapeCreators credits: GET https://api.scrapecreators.com/v1/credit-balance. Under 2,000 is P1 (stats stop for every user at 0).
>   - post_metrics for posts published in the last 30 days, in workspaces that aren't paused (workspaces.publishing_paused false): flag next_fetch_at more than 6 hours in the past, and last_error values that aren't an expected final reason (private post, deleted / no longer on the platform, waiting for TikTok to make it public, never made public, didn't publish). Several on one platform is P1; one or two is P2.
>   - account_follower_days: every connected (not disconnected) account created over 36 hours ago in an unpaused workspace needs a row for today or yesterday (UTC). Skip LinkedIn (no public count), and skip accounts whose handle is empty or equals the platform name on TikTok, Instagram, Threads, X and YouTube (not looked up yet). Missing counts are P2.
>   - Name users only as "a beta user" plus the account handle, never an email.
> 5) Severity: a platform failing repeatedly or jobs stuck is P1; everything failing, nothing publishing while jobs are due, prod down or a privacy leak is P0; logins expiring soon or accounts needing attention are P2 unless it's Aki's own account about to break a scheduled post (P1). For each new problem or user report not already on the Aligno board, file a card (status todo, "Board column: Inbox", correct labels; user reports get Source "From a user", uptime failures "From uptime alerts", PostHog findings "From PostHog", database and analytics findings "From a scheduled check"). If a card already covers it, add a comment with the new evidence instead.
> 6) If you filed anything or found a P0/P1, reply in this thread with a short plain-words digest (anything urgent first, then what was filed). If nothing is new, don't reply; just refresh the status checklist, including whether the live database was read. X credit still isn't checked.

Since launch, this check should also expect real sign-ups and billing activity
(new workspaces, Stripe subscriptions) and not treat them as anomalies.

### Weekly security check prompt

> Weekly security check for Post Social. Follow the shared rules for scheduled checks and the live-database read-only rules (plus the Aligno card style). Steps: 1) git pull main in the repo; run npm audit and npm outdated. 2) GitHub: secret scanning alerts and Dependabot alerts for sirakinb/post-social-official. 3) Review PRs merged in the last 7 days for access rules (RLS policies and migrations), auth, input from users and links, and secrets in code. 4) Re-check known gaps. 5) Live database, strictly read-only (GET on https://syydd6ck.us-east.insforge.app/api/database/records/<table> only; probe first and say plainly if it's unreachable): count api_keys and oauth_grants created in the last 7 days and flag any that look unexpected (by count and workspace id, no personal data). 6) File a card for each new finding (status todo, "Board column: Inbox", Type "Check finding", Source "From a scheduled check"); anything exploitable is P0 or P1. 7) Always reply in this thread with a short plain-words digest: anything urgent first, then what was filed, whether the live database was read, then "nothing else found" if so.

(The old prompt also flagged "workspaces created outside the invite flow"; since
open sign-up that is normal, so it's dropped here. The sign-in attempt limit gap
is resolved.)

### Weekly product check prompt

> Weekly product check for Post Social. Follow the shared rules for scheduled checks and the live-database read-only rules (plus the Aligno card style). Use the PostHog connector, project "Post Social" (642504), test accounts excluded: active users, the biggest drop-off, and publish failures, comparing the last 7 days with the week before. Then, strictly read-only, probe Post Social's live database (GET https://syydd6ck.us-east.insforge.app/api/database/records/workspaces?select=id&limit=1). If it answers 200, use it for the real numbers PostHog can only approximate: new workspaces (sign-ups), connected_accounts added by platform, posts scheduled and posts published by platform, and paid vs free workspaces (counts only, no personal data). If it doesn't, build the funnel from PostHog (first sign-in via $identify, the connect and schedule button_clicked tags, first post_published) and say which steps are approximated and that the database was unreachable. File cards for clear problems or opportunities (status todo, "Board column: Inbox", Source "From PostHog" or "From a scheduled check"), including one card if proper funnel events are still missing in PostHog. Always reply in this thread with a short plain-words digest: the numbers, the biggest drop-off, and what was filed.

### Monthly privacy check prompt

> Monthly privacy check for Post Social. Follow the shared rules for scheduled checks and the live-database read-only rules (plus the Aligno card style). Steps: 1) git pull main; compare what data the app actually collects and stores (migrations, PostHog setup, worker, edge functions) with what the Privacy page says; confirm PostHog masking (mask_all_element_attributes, input masking) is still on. 2) List third-party services the code sends data to and check they're named on the Privacy page. 3) Gmail: look for data-deletion requests to support@postsocial.xyz in the last month and whether each got answered. 4) Live database, strictly read-only (GET on https://syydd6ck.us-east.insforge.app/api/database/records/<table> only; probe first and say plainly if unreachable): list data_deletion_requests that are still open, and how long each has been waiting (ids and dates only). One waiting more than 30 days is P1. 5) File cards for any gap (status todo, "Board column: Inbox", Type "Check finding", Source "From a scheduled check"); a real leak is P0. Don't edit the Privacy page yourself; put the suggested wording in the card. 6) Always reply in this thread with a short plain-words digest, including whether the live database was read.

### Monthly cost and speed check prompt

> Monthly cost and speed check for Post Social. Follow the shared rules for scheduled checks and the live-database read-only rules (plus the Aligno card style). Steps: 1) git pull main; npm run build and record the bundle size against last month's figure (keep the number in project memory). 2) Look for obvious waste in code merged this month: unbounded queries, missing indexes in new migrations, polling loops, oversized images. 3) Gmail: find this month's bills or usage emails from InsForge, X (console.x.com), Resend, Vercel and ScrapeCreators and note the amounts. 4) Live database, strictly read-only (GET on https://syydd6ck.us-east.insforge.app/api/database/records/<table> only; probe first and say plainly if unreachable): count this month's X posts published (to estimate X spend at $0.015 a post, $0.20 with a link) and the growth of publish_jobs, media_assets and audit_events, and flag any table growing much faster than posts. 5) Cloudflare R2, read-only (token injected by the proxy for api.cloudflare.com; account 5e9cbd18080d4f973442560e2140a3e0): POST https://api.cloudflare.com/client/v4/graphql with r2StorageAdaptiveGroups (max payloadSize, objectCount by bucketName) for buckets postsocial-media-prod and postsocial-media-dev only; ignore the account's other buckets. Compare with last month's figures (keep them in project memory). R2 is free up to 10 GB, then about $0.015 per GB-month. Flag storage growing much faster than media_assets rows (leftover files). Only read; never create, change or delete anything in Cloudflare. 6) File cards for waste worth fixing (status todo, "Board column: Inbox", Source "From a scheduled check"). 7) Always reply in this thread with a short plain-words digest: the month's costs you could find, storage size and change, bundle size change, and what was filed. Say which costs you couldn't see.

R2 baseline (2026-10-14): prod 915.9 MB / 151 objects, dev 367.8 MB / 28 objects.

### Quarterly check prompt

> Quarterly check for Post Social. Follow the shared rules for scheduled checks (plus the Aligno card style). File these cards for Aki (status todo, "Board column: Inbox", Type "Chore", Source "From a scheduled check", each with a "What Aki needs to do" line), skipping any already open: rotate app secrets (LinkedIn, X, Bluesky key, Resend, Stripe webhook, InsForge keys); test restoring a database backup on dev; review who has access to GitHub, InsForge, Vercel, Stripe, X, Meta, TikTok and Aligno. Then search the web for API deprecation or policy notices from the eight platforms (TikTok, Instagram, Facebook, Threads, YouTube, LinkedIn, Bluesky, X) in the last 3 months and file a card for each that affects Post Social. Always reply in this thread with a short plain-words digest.

### Aligno work picker prompt (hourly at :56)

> Hourly Aligno pickup. GET in_progress tasks in Aligno project 5c2688a6-2748-4f3c-be2d-91ffc9b5218c (workspace_id da7ee67c-2f6f-4584-abaa-b71567973230, base https://alignopm.com/api/v1, auth injected by the proxy). Skip tasks with a comment starting "Claude started". Take up to 3 oldest, comment "Claude started <UTC timestamp>", then: for ops-only tasks, first check whether the work is already done (if so, close it as completed with a one-line note); otherwise comment what Aki must do, set status blocked, "Board column: Blocked". Everything else gets worked on branch claude/aligno-<first 8 of task id> with a failing test first, the fix, typecheck/lint/test/build green, a PR assigned to sirakinb with his review requested, the PR link commented on the card, status review, "Board column: In review". Never merge, deploy, promote, or touch prod or secrets. Reply in the thread only with a PR link or a blocker; otherwise end silently with a status refresh.

(The old picker prompt said "Board column: Waiting"; that wording is outdated,
the column is "Blocked".)

Note: in a private project, a scheduled task can only bind to the session that
creates it, so create each one from the thread you want it to post into.

---

## Project instructions (paste into the new project)

> - Owner is Aki (GitHub sirakinb), US Eastern time. Plain, conversational replies; minimize his manual steps. When he must run commands, batch them into one block. Prefer preview URLs over local dev.
> - Merges and prod deploys always wait for Aki's word in the thread. Once he says merge/deploy, do the whole rollout wherever connected services allow.
> - Check with Aki before pushing. An Aligno card moved to In Progress authorizes a PR for it.
> - Claude may start new threads/sessions to run commands, including on Aki's Mac (/Users/sirakinb/Documents/Thought-Social), without asking. Use temporary git worktrees so his working copy isn't touched.
> - Never put secrets in files, memory, or chat. Aki adds secrets to InsForge himself. If a key gets pasted in chat, tell him to rotate it.
> - Real outbound emails to users need Aki's approval in the thread, and always cc aki.b@pentridgemedia.com.
> - The cloud key for syydd6ck.us-east.insforge.app (Post Social prod) can write: keep to reads unless Aki asks. aid258ua.us-west.insforge.app is Aligno's backend, not Post Social: never touch it.
> - Aligno cards follow the plain-language card style in docs/claude-handoff.md.
> - Read docs/claude-handoff.md, AGENTS.md and docs/environments.md before starting work.

---

## Open items at handoff (2026-10-21)

- Google sign-in: Aki creates Post Social's own Google OAuth app (Google Cloud
  console: branding "Post Social", External, web client with InsForge's
  callback URL), pastes client id + secret into InsForge Auth → Google (prod),
  then flip `GOOGLE_SIGNIN` to true and deploy. Aligno card 096ccb99.
- Drop the "Beta" label and announce launch: Aki decides when. Aligno card
  41b38c4a (P3).
- Close the old Aligno card about InsForge needing to fix sign-in limits (done).
- Emmanuel will get the one-time email code step at his next sign-in.
- Mobile features (PR 64) not yet tried on a real phone: home-screen add,
  iPhone video upload, posting to TikTok + YouTube, the iPhone Shortcut.
- Convex shutdown: waits on Aki registering the InsForge TikTok callback in
  TikTok's developer portal (`docs/environments.md`).
- Platform approvals: submit the 3 Meta insights reviews and TikTok
  video.list; YouTube later with comments.
- Next build: Instagram comment → auto-DM ("our ManyChat"), in dev.
- Coming next per Aki: customer service setup. Later: staging branch, a
  "copy the setup prompt" agent onboarding, an 80% X-cap email warning, more
  testimonials on the landing page.
- Self-serve data deletion doesn't exist on InsForge yet; /data-deletion tells
  people to email support@postsocial.xyz.
- Post-v1 ideas list: Connections grouping, PostHog funnel events, per-account
  usage, testing discipline, security/privacy pass, analytics API. Pinterest is
  off the roadmap unless asked.

# PRD: Post Social agent-first relaunch on InsForge

Status: draft for approval (2026-09-30). Companion plan: `tasks/insforge-migration.md`.

## 1. Introduction

Post Social is social media management for the agent age: the agent version of Buffer or
Later. A person connects their social accounts once, then connects Post Social to the AI they
already use (Claude, ChatGPT, Cursor, Meta AI and others). From then on they manage their
social media by prompting that AI: drafting, previewing, scheduling, publishing, approving,
reviewing history and setting rules. Post Social is not an agent itself. It is the connection
between any AI and a person's social accounts, plus the engine that checks, schedules and
publishes posts safely.

Today Post Social runs on Convex, leads with a web app composer, and supports five platforms
(TikTok, Instagram, Facebook Pages, Threads, YouTube). This relaunch:

1. Moves the backend to InsForge with a clean dev and prod split.
2. Makes the REST API and remote MCP server the primary product, with full parity: anything the
   web app can do, the AI can do, except connecting social accounts (done in the web app,
   because platforms require the person to sign in on their own screens).
3. Adds Facebook Reels and Page video, Threads video and carousels, and three new platforms:
   LinkedIn, X and Bluesky.
4. Rebuilds the web app as a secondary, visual client of the same API, organised around
   approvals, activity, AI connections and rules.
5. Rewrites the landing page around "connect your AI".
6. Lays the groundwork for billing (usage metering and plan limits) without choosing prices.

There are no real users yet, so no user data migrates. Launch to testers happens after every
platform in scope works and after TikTok's Direct Post audit (submitted 2026-09-29) clears.

## 2. Goals

- A person can do everything in Post Social from Claude (custom connector, Claude Code) and
  ChatGPT (OAuth sign-in), except connecting social accounts.
- Every action is recorded with who did it: which AI connection, which API key, or the person
  in the web app.
- Publishing is reliable: scheduled posts go out within 60 seconds of their time, retries never
  create duplicate posts, and every failure has a plain-language reason.
- Eight platforms work end to end on prod: TikTok, Instagram, Facebook Pages, Threads,
  YouTube, LinkedIn, X, Bluesky.
- Dev and prod are fully separate: schema, functions, worker, storage and secrets.
- Usage is metered per workspace and per AI connection so any pricing model can be added later
  without a rebuild.

## 3. Default decisions (locked)

- One master PRD for the whole relaunch, organised by phase.
- LinkedIn, X and Bluesky are in scope for launch.
- Billing at launch is groundwork only: metering and plan limits. Pricing and checkout come later.
- A newly connected social account defaults to "ask me first": AI-created posts wait for the
  person's approval. The person can switch any account to autonomous.
- Agent posts to TikTok require the person's confirmation until we confirm TikTok's consent rule
  can be met inside an AI chat.
- Media lives on Cloudflare R2. Long-running work runs in a worker on InsForge Compute.
- Same platform apps for dev and prod. TikTok uses its sandbox in the same app. Meta, Google,
  LinkedIn, X and Bluesky get dev callback addresses added alongside prod.

## 4. User stories

Every story also requires: `npm run typecheck`, `npm run lint` and `npm test` pass. Stories that
change UI also require: verify in browser using the dev-browser skill.

### Phase 0: Setup

#### US-001: Create the InsForge project and dev branch
**Description:** As the developer, I need a prod project and a long-lived dev branch so changes are tested before they reach real accounts.

**Acceptance Criteria:**
- [ ] InsForge project `post-social` exists and the repo is linked (`.insforge/project.json`)
- [ ] A `dev` branch exists in `schema-only` mode and is `ready`
- [ ] `docs/environments.md` lists both URLs and how to switch between them
- [ ] No secrets are committed; `.insforge/` secrets and `.env*` files are gitignored

#### US-002: Repository layout and continuous checks
**Description:** As the developer, I need a predictable code layout and automatic checks on every change.

**Acceptance Criteria:**
- [ ] Folders exist: `backend/migrations/` (SQL), `backend/functions/` (InsForge functions), `worker/` (Node container), `src/` (web app)
- [ ] A GitHub Actions workflow runs typecheck, lint and tests on every push and pull request
- [ ] The workflow fails the build on any failing test

#### US-003: Cloudflare R2 storage for media
**Description:** As the developer, I need separate dev and prod media buckets reachable on our own domain so platforms can fetch media.

**Acceptance Criteria:**
- [ ] Buckets `postsocial-media-dev` and `postsocial-media-prod` exist
- [ ] Prod media is served from `media.postsocial.xyz`; dev from a separate subdomain
- [ ] CORS allows direct browser uploads from the web app domains only
- [ ] Bucket credentials are stored as InsForge secrets, never in code

#### US-004: Vercel environments
**Description:** As the developer, I need Vercel Production to use prod and Vercel Preview to use dev.

**Acceptance Criteria:**
- [ ] Production environment variables point at the prod InsForge project and prod bucket
- [ ] Preview environment variables point at the dev branch and dev bucket
- [ ] A preview deployment loads and shows which environment it is using in the footer (dev only)

### Phase 1: Data and sign-in

#### US-005: Workspaces and membership schema
**Description:** As a person, I want my own workspace so my accounts and posts are private to me and my team.

**Acceptance Criteria:**
- [ ] Tables `workspaces` and `workspace_members` (roles: owner, admin, member) created by a migration file
- [ ] Row-level security: a person can only read and write workspaces they belong to
- [ ] A test proves a member of workspace A cannot read workspace B

#### US-006: Connected accounts and encrypted credentials schema
**Description:** As a person, I want my social account tokens stored securely so nobody can read them.

**Acceptance Criteria:**
- [ ] Tables `connected_accounts` (platform, handle, display name, avatar, health, capabilities) and `credentials` (encrypted tokens, expiry times)
- [ ] Tokens are encrypted with AES-256-GCM using a key held only in secrets
- [ ] `credentials` has no row-level read access for app clients; only the worker and server functions can read it
- [ ] A test proves the web app client cannot select from `credentials`

#### US-007: Posts, destinations, media, jobs and approvals schema
**Description:** As the developer, I need the publishing data model in Postgres.

**Acceptance Criteria:**
- [ ] Tables `posts`, `destinations`, `media_assets`, `publish_jobs`, `approval_requests`, `approvals` created by migrations
- [ ] Post and destination statuses match the current state machine, including `approved/scheduled -> awaiting_approval` on caption edit
- [ ] `publish_jobs` has a unique idempotency key per destination and attempt group
- [ ] Indexes support: posts by workspace and created time, posts by workspace and scheduled time, due jobs by state and next attempt time

#### US-008: "Who did it" on every action
**Description:** As a person, I want to see which AI or key did each thing so I can trust and debug my setup.

**Acceptance Criteria:**
- [ ] Table `actors` records each identity: the person (web app), an API key, or an OAuth client connection (for example "Claude, Aki's connection")
- [ ] `posts`, `destinations`, `approvals` and `audit_events` store `actor_id`
- [ ] `audit_events` stores event type, target, a plain-language summary, and before/after values for edits
- [ ] A test creates a post through an API key and confirms the audit event names that key

#### US-009: API clients schema
**Description:** As the developer, I need to store API keys and OAuth client connections.

**Acceptance Criteria:**
- [ ] Table `api_keys`: name, hashed key (never the raw key), prefix for display, mode (`test` or `live`), created, last used, revoked
- [ ] Tables `oauth_clients` and `oauth_grants` for MCP sign-in (client name, redirect URIs, scopes, refresh tokens hashed)
- [ ] Each API key and OAuth grant maps to one actor

#### US-010: Usage metering and plan limits schema
**Description:** As the business owner, I want usage counted and limits stored as data so pricing can be added later without a rebuild.

**Acceptance Criteria:**
- [ ] Table `usage_events`: workspace, actor, event type (`post_published`, `media_stored_bytes`, `media_transferred_bytes`, `api_call`, `account_connected`), quantity, time
- [ ] Table `plans` and `workspace_plans` hold limits as data (for example max accounts, posts per month); one default plan `tester` with generous limits
- [ ] A function returns current-period usage for a workspace
- [ ] Limits are checked in one shared function; exceeding a limit returns a plain-language error

#### US-011: Sign in with InsForge Auth
**Description:** As a person, I want to sign in with email and password and reset my password if I forget it.

**Acceptance Criteria:**
- [ ] Sign in, sign out and password reset work on dev using InsForge Auth
- [ ] `/app/*` redirects signed-out visitors to `/login`
- [ ] Session refresh uses httpOnly cookies via the InsForge SSR helpers
- [ ] Public sign-up stays disabled; accounts are created by an admin script
- [ ] Verify in browser using dev-browser skill

#### US-012: Recreate owner and reviewer accounts
**Description:** As the owner, I want my login and the platform reviewer login to exist on the new backend.

**Acceptance Criteria:**
- [ ] A script creates a user, a workspace and owner membership, with a password supplied by the person running it (never stored in the repo)
- [ ] Owner and reviewer accounts exist on dev, and later on prod

### Phase 2: Media

#### US-013: Upload media directly to R2
**Description:** As a person, I want to upload large videos quickly from the browser.

**Acceptance Criteria:**
- [ ] A server function issues a signed upload URL scoped to one object key in the workspace's folder
- [ ] Uploads up to 1 GB use multipart upload and show progress
- [ ] After upload, the media record stores size, MIME type, width, height and duration
- [ ] Verify in browser using dev-browser skill (upload a 500 MB video on dev)

#### US-014: Import media from a URL
**Description:** As an AI, I want to give Post Social a link to a file so I don't need to upload bytes.

**Acceptance Criteria:**
- [ ] `POST /v1/media/import` accepts an https URL, downloads it in the worker, and stores it in R2
- [ ] Rejects non-https URLs, private network addresses, files over 1 GB, and unsupported types, with clear messages
- [ ] Returns a media id and status (`processing`, `ready`, `failed`)

#### US-015: Media library and cleanup
**Description:** As a person, I want to reuse uploaded media and not pay to store media forever.

**Acceptance Criteria:**
- [ ] List, rename and hide media in the library
- [ ] Media not attached to any unpublished post is deleted after a configurable retention period (default 30 days after last use)

### Phase 3: Connections

#### US-016: Shared social sign-in framework
**Description:** As the developer, I need one way to run every platform's sign-in so each platform only adds its specifics.

**Acceptance Criteria:**
- [ ] Single-use, hashed `state` with a 10-minute expiry protects every callback
- [ ] Callbacks live at `/oauth/{platform}/callback` on each environment
- [ ] On success, tokens are encrypted and stored, account health is `connected`, and an audit event is written
- [ ] Reconnecting the same account updates it instead of creating a duplicate

#### US-017 to US-024: Connect each platform
One story per platform: Instagram (Instagram Login), Facebook Pages, Threads, YouTube, TikTok (sandbox on dev, live keys on prod), LinkedIn, X, Bluesky.

**Acceptance Criteria (each):**
- [ ] The person can connect from the Accounts page on dev and sees the account with avatar and handle
- [ ] Only the permissions listed for that platform in section 6 are requested
- [ ] Capabilities are stored (post types, caption limit, video length and size limits)
- [ ] Verify in browser using dev-browser skill

#### US-025: Token refresh, disconnect and revoke
**Description:** As a person, I want connections to keep working and to disconnect cleanly.

**Acceptance Criteria:**
- [ ] The worker refreshes tokens before expiry; failures set health to `needs_attention` with a reason
- [ ] Disconnect revokes the token at the platform where the platform supports it, deletes stored credentials, and cancels that account's pending posts
- [ ] Audit events are written for refresh failures and disconnects

#### US-026: Meta data deletion and deauthorize endpoints
**Description:** As the business, we must honour Meta's deletion and deauthorize callbacks.

**Acceptance Criteria:**
- [ ] `POST /meta/data-deletion` verifies the signed request and deletes that person's data, returning a status URL and confirmation code
- [ ] `GET /meta/data-deletion/status` reports the status
- [ ] `POST /meta/deauthorize` disconnects the account
- [ ] Existing signed-request tests pass against the new code

### Phase 4: Publishing engine

#### US-027: Job queue and worker loop
**Description:** As the developer, I need a reliable worker that sends due posts.

**Acceptance Criteria:**
- [ ] The worker claims due jobs with a lease (`FOR UPDATE SKIP LOCKED`) so two workers never send the same job
- [ ] Retries use exponential backoff for temporary errors and stop after 3 attempts
- [ ] A job that may have reached the platform is never retried blindly; it is checked by status first
- [ ] A test simulates a crash mid-publish and proves no duplicate post is created

#### US-028: Scheduling on time
**Description:** As a person, I want scheduled posts to go out when I said.

**Acceptance Criteria:**
- [ ] Scheduled posts start publishing within 60 seconds of their time
- [ ] Rescheduling and cancelling work until the job starts
- [ ] Times are stored in UTC and shown in the viewer's time zone

#### US-029: Approvals
**Description:** As a person, I want AI-created posts on "ask me first" accounts to wait for me.

**Acceptance Criteria:**
- [ ] New accounts default to "ask me first"
- [ ] Approve, reject, and edit-then-approve work from the API, MCP and web app
- [ ] Editing an approved or scheduled post on an "ask me first" account cancels queued jobs and returns it for approval
- [ ] Autonomous accounts publish without approval
- [ ] Agent posts to TikTok always require the person's confirmation (until the open question in section 10 is resolved)

#### US-030: Validation before publishing
**Description:** As an AI, I want to know what's wrong before publishing so I can fix it myself.

**Acceptance Criteria:**
- [ ] `POST /v1/posts/validate` returns, per destination, a list of problems in plain language (for example "Facebook Reels must be 3 to 90 seconds; this video is 120 seconds")
- [ ] The same rules run again at publish time
- [ ] Rules are covered by unit tests per platform

#### US-031: Instagram publishing
**Acceptance Criteria:**
- [ ] Image, Reel and carousel (2 to 10 items) publish on dev to a test account
- [ ] Media is fetched by Instagram from R2 URLs
- [ ] The live link is stored on success

#### US-032: Facebook Pages publishing, including video
**Acceptance Criteria:**
- [ ] Text, link and single-image posts publish to a Page
- [ ] Reels publish via the Reels publishing flow (start, upload, finish); videos must be 9:16, 3 to 90 seconds, MP4
- [ ] Regular Page video publishes
- [ ] The person must have content-creation permission on the Page; otherwise a clear error

#### US-033: Threads publishing, including video and carousels
**Acceptance Criteria:**
- [ ] Text, image, video (up to 5 minutes, 1 GB, MP4 or MOV) and carousel (up to 20 images and videos) publish on dev
- [ ] The worker waits for each media container to finish processing before publishing
- [ ] Respects the 250 posts per 24 hours profile limit with a clear error

#### US-034: YouTube Shorts publishing
**Acceptance Criteria:**
- [ ] A vertical video uploads with title, description and privacy status using resumable upload from the worker
- [ ] The local quota guard (6 uploads per day by default) still applies with a clear message

#### US-035: TikTok publishing
**Acceptance Criteria:**
- [ ] Direct Post video and photo posts work with creator info checked within 10 minutes of posting
- [ ] Draft upload to the creator's inbox works (`video.upload`)
- [ ] Media is pulled from the verified R2 domain where possible, otherwise chunked upload from the worker
- [ ] Privacy has no default; comments, duet and stitch default off; content disclosure and AI-generated labels are supported

#### US-036 to US-038: LinkedIn, X and Bluesky publishing
One story per platform.

**Acceptance Criteria (each):**
- [ ] Text, image and video posts publish on dev to a test account, within that platform's limits
- [ ] The live link is stored on success
- [ ] Platform rate limits are respected with a clear message when hit

#### US-039: Results and status
**Description:** As a person, I want to know exactly what happened to each post on each platform.

**Acceptance Criteria:**
- [ ] Each destination shows one of: draft, awaiting approval, scheduled, publishing, published, failed, cancelled
- [ ] Failures store a short code and a plain-language message
- [ ] Published destinations store the live link where the platform provides one

### Phase 5: Agent layer (the core product)

#### US-040: REST API v1
**Description:** As a developer or AI, I want a stable, documented API.

**Acceptance Criteria:**
- [ ] Endpoints cover every capability in section 5 (accounts, media, posts, approvals, activity, rules, connections, usage)
- [ ] An OpenAPI 3.1 spec is generated and published at `/v1/openapi.json`
- [ ] Errors use one shape: `{ error: { code, message, details } }`
- [ ] Write endpoints accept an `Idempotency-Key` header and return the same result on repeat

#### US-041: API keys, including test keys
**Description:** As a person, I want to create named keys for my AIs and tools, and safe test keys that never publish.

**Acceptance Criteria:**
- [ ] Create a named key; the full key is shown once, then only its prefix
- [ ] Keys show created date, last used date and mode (test or live); revoke takes effect immediately
- [ ] Test keys can validate, create drafts and get preview links, but publish and schedule calls return "test keys cannot publish"
- [ ] Verify in browser using dev-browser skill

#### US-042: OAuth sign-in for AI apps
**Description:** As a ChatGPT or Claude user, I want to connect Post Social by signing in, without pasting a key.

**Acceptance Criteria:**
- [ ] OAuth 2.1 authorization server with PKCE, dynamic client registration, and protected resource metadata for the MCP endpoint
- [ ] A consent screen shows which app is asking and what it will be allowed to do
- [ ] Each grant becomes a named actor (for example "ChatGPT") that can be revoked from AI connections
- [ ] Connecting from ChatGPT and from a Claude custom connector both work on dev

#### US-043: Remote MCP server
**Description:** As an AI, I want an MCP server with clear tools for everything Post Social does.

**Acceptance Criteria:**
- [ ] Streamable HTTP MCP endpoint at `/mcp`, authenticated by API key (Authorization header) or OAuth token
- [ ] Every tool in section 5 exists with a short description and typed inputs
- [ ] Sensitive tools are annotated as destructive so AI clients ask the person to confirm
- [ ] Tool results include plain-language summaries and links (preview, approval, live post)

#### US-044: Rules engine
**Description:** As a person, I want to control what each AI can do, per account.

**Acceptance Criteria:**
- [ ] Per account: "ask me first" or autonomous; optional daily cap; optional quiet hours; optional "approvals only in the web app"
- [ ] Per AI connection: each action (draft, publish, schedule, delete, change rules, manage connections) is Allow, Ask first, or Off
- [ ] Rules are enforced in the API (the MCP and web app cannot bypass them)
- [ ] Changing rules through an AI is a sensitive tool

#### US-045: Usage tracking
**Acceptance Criteria:**
- [ ] Every publish, API call, media store and transfer writes a usage event
- [ ] `GET /v1/usage` and an MCP tool return current-period usage per account and per AI connection

#### US-046: Documentation for people and AIs
**Acceptance Criteria:**
- [ ] API reference generated from the OpenAPI spec
- [ ] Setup guides: Claude custom connector, Claude Code, ChatGPT, Cursor, plain REST
- [ ] `/llms.txt` summarises the API and tools for AIs

### Phase 6: Web app (secondary client of the same API)

#### US-047: New navigation
**Acceptance Criteria:**
- [ ] Sidebar: Overview, Approvals, Activity, Calendar, Accounts, AI connections, Rules, Settings
- [ ] "New post" is a top-bar button, not a sidebar item
- [ ] The web app calls the same API as AIs; no web-only backend functions
- [ ] Verify in browser using dev-browser skill

#### US-048: Overview
**Acceptance Criteria:**
- [ ] Shows what's waiting for approval, recent activity, and any account that needs attention
- [ ] Each item links to its detail
- [ ] Verify in browser using dev-browser skill

#### US-049: Approvals inbox
**Acceptance Criteria:**
- [ ] Sections: Needs your review, Scheduled, Published, Failed, with counts
- [ ] Clicking a post opens a side panel with the platform mockup, caption editing, and Approve and Reject
- [ ] Every post shows a "via Claude"-style tag naming its actor
- [ ] Verify in browser using dev-browser skill

#### US-050: Activity
**Acceptance Criteria:**
- [ ] Table with time, who (actor icon and name), what happened, target and outcome
- [ ] Filters: AI connection, account, platform, outcome, date range
- [ ] Caption edits show before and after
- [ ] Verify in browser using dev-browser skill

#### US-051: Calendar and Accounts on the new API
**Acceptance Criteria:**
- [ ] Calendar loads by visible month and links to previews (as it does today)
- [ ] Accounts shows each connection's health, capabilities and Connect, Reconnect and Disconnect buttons for all eight platforms
- [ ] Verify in browser using dev-browser skill

#### US-052: AI connections page
**Acceptance Criteria:**
- [ ] Lists connected AIs (OAuth grants) and API keys with last used dates and revoke
- [ ] "Add to your AI" tabs for Claude, ChatGPT, Cursor and REST, each with copyable steps and the MCP URL
- [ ] Verify in browser using dev-browser skill

#### US-053: Rules page
**Acceptance Criteria:**
- [ ] Per account and per AI controls from US-044, grouped like a connector permission panel (read actions vs write actions, each Allow, Ask first or Off)
- [ ] Verify in browser using dev-browser skill

#### US-054: Composer on the new API
**Acceptance Criteria:**
- [ ] Supports all eight platforms and the new post types (Facebook Reels and video, Threads video and carousels)
- [ ] Keeps TikTok's required composer rules (creator nickname, no privacy default, interactions off by default, disclosure, music usage confirmation)
- [ ] Verify in browser using dev-browser skill

#### US-055: Platform mockups for every platform
**Acceptance Criteria:**
- [ ] Mockups registered for TikTok (exists), Instagram (feed and Reel), Facebook (post and Reel), Threads, YouTube Shorts, LinkedIn, X and Bluesky
- [ ] Each mockup shows the account, caption with the platform's truncation, and media fit
- [ ] Verify in browser using dev-browser skill

#### US-056: Live status updates
**Acceptance Criteria:**
- [ ] Destination status changes appear in the web app within 5 seconds using InsForge realtime
- [ ] No unbounded polling

#### US-057: Port the test suite
**Acceptance Criteria:**
- [ ] All existing rule and UI tests (210 today) are ported or replaced with equivalents
- [ ] New tests cover RLS, the worker, idempotency and every MCP tool

### Phase 7: Landing page

#### US-058: New hero and messaging
**Acceptance Criteria:**
- [ ] Headline and subhead from the approved copy; primary button "Connect your AI", secondary "Read the docs"
- [ ] Hero visual is a chat with an AI that ends in a platform mockup card of the post
- [ ] Logo, plum `#9B6CFF` and dark grid style are kept; headings stay modest in size
- [ ] Verify in browser using dev-browser skill

#### US-059: Supporting sections
**Acceptance Criteria:**
- [ ] "Works with" strip with official AI app and platform logos (only ones that work at launch)
- [ ] "Stay in control from the chat" section with real example prompts and replies
- [ ] Three steps: connect accounts, add Post Social to your AI, just ask
- [ ] Developer section with MCP URL and API example, tabs for Claude, ChatGPT, Cursor and cURL, and copy buttons
- [ ] "The app, when you want to look" section with real screenshots
- [ ] Trust section: official sign-in, encrypted connections, approval rules, full history
- [ ] No invented testimonials, customer counts or prices
- [ ] Verify in browser using dev-browser skill

### Phase 8: Hardening

#### US-060: Logs and alerts
- [ ] Structured logs for functions and the worker with a request id
- [ ] An alert fires when publish failures exceed 5 in 10 minutes, or the worker stops claiming jobs for 5 minutes

#### US-061: Backups and recovery
- [ ] Daily database backups on prod, with a tested restore to a branch

#### US-062: Security review
- [ ] RLS, token encryption, OAuth server, signed upload URLs, URL import (SSRF) and webhook signatures reviewed; findings fixed or recorded

#### US-063: Load test
- [ ] 50 concurrent 500 MB uploads and 200 scheduled posts in the same minute complete without errors or duplicates on dev

### Phase 9: Launch

#### US-064: Promote to prod
- [ ] Schema merged from dev to prod after a reviewed dry run
- [ ] Functions and worker deployed to prod; prod secrets set

#### US-065: Prod callback addresses
- [ ] Prod callback addresses added in Meta (both apps), Google, LinkedIn, X and Bluesky settings, with the owner's OK on each save
- [ ] TikTok's is added last, after its audit clears
- [ ] Old Convex addresses are removed only after prod is verified

#### US-066: Smoke test and switch
- [ ] Owner and reviewer accounts exist; all eight platforms reconnected
- [ ] One real post per platform from Claude and one from the web app succeed
- [ ] Vercel Production switched to prod
- [ ] Convex kept read-only for two weeks, then shut down

## 5. Functional requirements

Core and parity
- FR-1: Every capability is exposed through the REST API and the MCP server. The web app uses only the API.
- FR-2: Connecting a social account happens in the web app. The API and MCP return a connect link for the person to open.
- FR-3: Every create, update, delete, approve, publish and rule change writes an audit event with its actor.

Accounts
- FR-4: List connected accounts with platform, handle, health and capabilities (post types, caption limit, video duration and size limits, image limits).
- FR-5: Create a connect link for a platform; disconnect an account.

Media
- FR-6: Get a signed upload URL; import media from an https URL; list, rename and hide media.

Posts
- FR-7: Create and edit a draft with a shared caption, optional per-platform text, media, destinations and per-platform options.
- FR-8: Validate a draft and return plain-language problems per destination.
- FR-9: Return a preview link for every draft that opens the platform mockups.
- FR-10: Publish now, schedule, reschedule and cancel.
- FR-11: Return results per destination, including live links.

Approvals
- FR-12: List posts waiting for approval; approve, reject, or edit then approve.
- FR-13: Editing an approved post on an "ask me first" account returns it for approval.

Activity and usage
- FR-14: List audit events filterable by actor, account, platform, outcome and date.
- FR-15: Return current-period usage per workspace, account and actor.

Rules and connections
- FR-16: Get and set rules per account and per AI connection.
- FR-17: List, rename and revoke API keys and OAuth grants; create API keys (live and test).
- FR-18: Sensitive tools (turning off approvals, changing rules, creating keys, disconnecting accounts, deleting posts) are marked destructive.
- FR-19: An account set to "approvals only in the web app" rejects approval calls from the API and MCP with a clear message.

Publishing
- FR-20: Scheduled posts start within 60 seconds of their time.
- FR-21: A destination is never published twice for the same post.
- FR-22: Platform limits and rate limits are enforced before calling the platform.

Billing groundwork
- FR-23: Usage events are recorded for publishes, API calls, media stored and transferred, and accounts connected.
- FR-24: Plan limits are read from data; exceeding one returns a plain-language error.

## 6. Platform scope at launch

| Platform | Post types | Permissions or scopes (request only these) |
|---|---|---|
| TikTok | video, photo, inbox draft | `user.info.basic`, `video.publish`, `video.upload` |
| Instagram | image, Reel, carousel | `instagram_business_basic`, `instagram_business_content_publish` |
| Facebook Pages | text, link, image, Reel, Page video | `pages_show_list`, `pages_read_engagement`, `pages_manage_posts` |
| Threads | text, image, video, carousel | `threads_basic`, `threads_content_publish` |
| YouTube | Shorts | `youtube.upload` |
| LinkedIn | text, image, video | to confirm (section 10) |
| X | text, image, video | to confirm (section 10) |
| Bluesky | text, image, video | to confirm (section 10) |

## 7. Non-goals (out of scope for this relaunch)

- Native listings in the ChatGPT plugin directory, Claude connector directory or Meta AI connectors (Phase 2 after launch). Applying for Meta's early access can happen in parallel.
- Choosing prices, checkout, invoices or subscriptions.
- Comment and DM automation, analytics and insights.
- Instagram Stories and Facebook Stories.
- TikTok for Business APIs.
- Mobile apps.
- Migrating Convex data (there are no real users).
- Building an AI agent inside Post Social; the person's own AI does the thinking.

## 8. Design considerations

- Brand: keep the current logo, plum `#9B6CFF`, dark plum surfaces with the grid and groove texture, modest heading sizes, official platform logos, real app screenshots. Audience is creators, solopreneurs and small businesses. No agency branding, invented testimonials, counts or prices.
- Reuse: the preview page, platform mockup registry, caption editor and copy-caption button built in September 2026.
- Reference screens (Mobbin):
  - Chat-as-hero: [Mistral](https://mobbin.com/sites/sections/4b3cb1c6-ebdb-48f1-9d25-693bffddde6c), [Intercom](https://mobbin.com/sites/sections/19604466-8f10-440d-8f55-5fcad0e9573a)
  - Developer section: [Stripe](https://mobbin.com/sites/sections/286613b2-cec3-4b45-ba6e-77930aa42ef4), [xAI](https://mobbin.com/sites/sections/1cf704f0-a00a-4b0d-93a7-81b87f53ea57)
  - Overview: [7shifts](https://mobbin.com/screens/cc7d3fa8-66ee-45cb-9332-e7e557975c70)
  - Approvals inbox and side panel: [Graphite](https://mobbin.com/screens/b4ac89ad-1ac3-4b85-a94d-71b22d6dede8), [Revolut Business](https://mobbin.com/screens/82df1cb8-945f-4649-ad95-3717f0f7e784), [Airwallex](https://mobbin.com/screens/f13414b4-443f-4484-bd3a-4b5970db2cc3)
  - Activity: [PlanetScale](https://mobbin.com/screens/d7448333-6400-49dd-b11f-e48e4e229200), [Toggl](https://mobbin.com/screens/2deef352-1f6b-4757-a4c9-dcce106b0e6a)
  - AI connections: [Claude connector page](https://mobbin.com/screens/2eb6c9a1-64f2-46a8-9cf8-ba9b1897ba86), [Cursor add MCP](https://mobbin.com/screens/3c3e7366-55af-4443-b91d-9f62f7683680), [OpenAI API keys](https://mobbin.com/screens/95abdf6b-a895-46b6-af35-2cd0b0ab0a87), [WorkOS staging and production keys](https://mobbin.com/screens/15940c03-778f-4c3a-8f90-ca04a73a7739)
  - Rules: [Perplexity connector permissions](https://mobbin.com/screens/8f2492ed-3103-46cc-9345-d5d6354e15b7)

## 9. Technical considerations

- Architecture, environments and phases are detailed in `tasks/insforge-migration.md`.
- InsForge: Postgres with row-level security, Auth, Functions (Deno), Realtime, Schedules, branches. Branches copy the schema but not code; functions and the worker are deployed to each environment.
- Worker: Node container on InsForge Compute; claims jobs from Postgres; reuses existing platform code (chunked uploads, token refresh, status polling).
- Media: Cloudflare R2 with signed uploads; platforms fetch from `media.postsocial.xyz`.
- Agents: MCP over streamable HTTP; API keys via Authorization header (Claude, Claude Code, Cursor); OAuth 2.1 with PKCE and dynamic client registration (required for ChatGPT, preferred for Claude).
- Secrets live in InsForge secrets per environment and are copied from Convex without being displayed.
- Performance: API p95 under 500 ms for reads; MCP tool calls return within 10 seconds or return a job id to poll.

## 10. Success metrics

- The owner completes "connect an account, add Post Social to Claude, ask for a scheduled post" in under 5 minutes on prod.
- 100% of actions in the audit log name their actor.
- Zero duplicate posts in a 7-day soak test with forced worker restarts.
- 99% of scheduled posts start within 60 seconds of their time during the soak test.
- A real post succeeds on all eight platforms from Claude and from ChatGPT before testers are invited.
- Every capability in the web app is also available as an MCP tool (checked against a parity list).

## 11. Open questions

- LinkedIn: which product is approved (personal profile posting, Company Page posting, or both) and which scopes?
- X: which API access tier is needed for posting media, and what does it cost?
- Bluesky: OAuth (AT Protocol OAuth) or app passwords for connecting?
- TikTok: can its consent rule be satisfied by a confirmation inside an AI chat, or does it require our interface?
- InsForge: function time limits, Compute pricing, cost of a long-lived dev branch, maximum upload size.
- Cloudflare: current R2 pricing; TikTok domain verification for `media.postsocial.xyz`.
- Media retention: how long to keep published media (default proposed: 30 days after last use).
- Teams: are multiple members per workspace needed at launch, or owner only?
- Pricing model (usage-based, subscription or hybrid) after tester data is available.

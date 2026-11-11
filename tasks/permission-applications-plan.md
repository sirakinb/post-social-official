# Permission applications: plan and running log

Started 2026-11-10. Owner: Aki. Driver: Claude. This file is the running log: each
section's **Status** line and the log at the bottom are updated as work happens.

Goal: official analytics on every platform, then Inbox (comments and DMs) where a platform
allows it.

## How we work

| Who | Does |
|---|---|
| Claude | Checks each portal, makes code and config changes on a feature branch, rehearses each demo, drives the screen during recording, adds captions, drafts every form answer, fills forms up to the last step |
| Aki | Signs in when a portal or test account asks, starts and stops QuickTime, uploads videos, ticks "I agree", presses Submit, adds secrets to InsForge, says the word for prod changes |

Rules that apply to every section:

- No passwords typed or stored by Claude. No secrets in files, memory or chat.
- Nothing is submitted, pushed or deployed to prod without Aki's word.
- Dev's worker and functions deploy only from local branch `dev-worker-inbox-trial` while
  Meta's Inbox review runs. Code needed on dev for a demo is merged into that branch first.
- Never touch `aid258ua.us-west.insforge.app`.

## How each video gets made

1. Claude rehearses the whole flow on staging
   (`https://post-social-git-staging-app-build-26.vercel.app/beta`, workspace "Adzo Test's
   workspace") and fixes anything that breaks.
2. Claude removes Post Social from the test account's app permissions on the platform, so
   the recording shows a fresh sign-in with the permission screen.
3. Aki signs in to the test account in the built-in browser and starts a QuickTime screen
   recording of that window. Claude drives. Aki stops the recording.
4. Claude trims it, scales to 1080p and burns in captions with ffmpeg. No narration.
5. Files go to `~/Documents/Post Social reviews/<platform>/` (outside the repo; say if you
   want another folder).

Every video has the same two halves: (a) fresh sign-in showing the permission being
granted, (b) the Post Social screen that uses the data.

---

## 1. Meta: insights (Instagram, Threads, Facebook)

**Status (checked 2026-11-10 in both dashboards):** all three insights permissions are in
the review submitted 2026-11-04. Both apps show "Review in progress". Nothing to add;
wait for Meta (about 2026-11-24).

| App | New requests in the review |
|---|---|
| Post Social `1322708666515720` | `read_insights`, `threads_manage_insights`, `threads_manage_replies`, `threads_read_replies`, `pages_messaging`, `pages_manage_metadata`, `pages_manage_engagement`, `pages_read_user_content`, Business Asset User Profile Access |
| Post Social-IG `2155585218350381` | `instagram_business_manage_insights`, `instagram_business_manage_comments`, `instagram_business_manage_messages` |

Facebook Login for Business configurations on app 1322708666515720: "Post Social"
`1323998036481160`, "Post Social stats" `4508952842697740` (the one for
`META_STATS_LOGIN_CONFIG_ID`), "Post Social inbox" `2361362058011639`.

The steps and demo script below are kept only in case Meta rejects one of the three.

| | |
|---|---|
| Asking for | `instagram_business_manage_insights` (views, reach, shares, saves on Instagram posts), `threads_manage_insights` (all Threads numbers), `read_insights` (plays and reach on Page posts) |
| Why | Replace public-page numbers with each account's own official numbers on the Analytics page |
| Portal | developers.facebook.com → app → App Review → Requests |
| Apps | Post Social-IG `2155585218350381` (Instagram). Post Social `1322708666515720` (Facebook and Threads) |
| Code | Built. Scopes in `backend/lib/connections/platforms.ts`; reads in `worker/src/analytics/platforms.ts` |

What we know: `tasks/meta-review-inbox.md` says `read_insights` and
`threads_manage_insights` were already filled in on app 1322708666515720 when the Inbox
submission went out. It does not mention `instagram_business_manage_insights` on the
Instagram app. That one is the likely gap.

Steps:

1. Aki signs in to developers.facebook.com in the built-in browser. Claude reads App Review
   → Requests on both apps and records here exactly which permissions are in review. Read
   only: nothing is added or edited on an app that's in review.
2. For each of the three that is already in review: nothing to do but wait.
3. For any that is missing: a submission in review can't be added to, so Claude prepares
   everything now (test API call, video, text) and it goes in as a new request the day the
   current review finishes.
4. Facebook only: confirm a second Facebook Login for Business configuration with
   `read_insights` exists (prod's configuration stays as it is) and note its id for
   `META_STATS_LOGIN_CONFIG_ID`.

Demo script, only if something is missing (example: Instagram):

| Scene | On screen | Caption |
|---|---|---|
| 1 | Post Social → Accounts → Connect Instagram | "Connecting an Instagram account to Post Social" |
| 2 | Instagram sign-in as @adzotest, permission screen listing insights | "The creator grants access to their insights" |
| 3 | Back in Post Social, account shows Connected | "Account connected" |
| 4 | Analytics page, Instagram filter, a recent post's views, reach, shares, saves | "instagram_business_manage_insights: the creator's own post numbers" |
| 5 | Open one post's detail | "Shown only to the creator's workspace" |

Submission text (draft, same style as the Inbox submission):

> Post Social is a social media management app. Its Analytics page shows a creator how
> their own posts performed. instagram_business_manage_insights is used to read views,
> reach, shares and saves for posts on the connected account, so the creator sees them next
> to their other platforms. We read insights only for the connected account's own media,
> show them only to that account's workspace, and do not sell or share them. The screencast
> shows connecting Instagram (with the permission screen) and the Analytics page with that
> account's numbers.

Threads and Facebook texts follow the same pattern and get written only if needed.

When approved: add the platform to prod `ANALYTICS_PLATFORMS` (InsForge and Vercel), set
prod `META_STATS_LOGIN_CONFIG_ID` for Facebook, redeploy `api`, `connections`, worker and
site, then users reconnect once. All of that waits for Aki's word.

Aki's steps: sign in to Meta; later, upload, "I agree" and Submit if a new request is needed.

---

## 2. Google: brand verification and YouTube scopes

**Status:** started 2026-11-10. Privacy page change is committed on this branch (not
pushed). Waiting on a Google sign-in that can open project 312431664994.

| | |
|---|---|
| Asking for | Data access verification for `youtube.upload` (already used, never verified) and `youtube.readonly` (stats). Brand verification is already done (checked 2026-11-10) |
| Why | Remove Google's "unverified app" warning and the 100-user cap, and read official YouTube numbers |
| Portal | console.cloud.google.com → Google Auth Platform → Branding, Data Access, Verification Center |
| Client | `312431664994-l89fsqcuhv1j4mr1pbp7e3grq3j3vekj` |
| Test account | Channel @AdzoTest (adzotest1@gmail.com) |

Prerequisites:

| Item | State |
|---|---|
| postsocial.xyz verified in Search Console | Done (domain property) |
| Privacy and terms pages live | Done, but see code change 1 |
| YouTube callback on our domain | Done: `https://www.postsocial.xyz/oauth/youtube/callback` |
| Home page describes the app and links to the privacy page | To check |
| Logo, 120×120 px | To make from the brand icon in `public/` |
| adzotest1@gmail.com listed as a test user on the consent screen | To check |

**Decision A: `youtube.force-ssl` (comments).** There is no YouTube comments code on any
branch yet. Google approves a scope only when the video shows a working feature using it,
and a scope with no feature can hold up the whole submission.

- Recommended: submit now with branding, `youtube.upload` and `youtube.readonly`. Add
  `youtube.force-ssl` later, once YouTube comments exist in Inbox. Adding a scope later is
  a smaller review; the brand stays verified.
- Alternative: build YouTube comments in Inbox first (read, reply, hide), then submit
  everything once. Analytics waits on that build.

**Decision B: Google sign-in.** Its callback is on `syydd6ck.us-east.insforge.app`, a
domain we can't verify.

**Decided 2026-11-10 (Aki):** sign-in stays out of this submission and gets its own step
afterwards. The consent screen must say Post Social.

- Google's brand verification checks the domain of every redirect URI on the project's web
  clients, and each must be verified in Search Console
  (developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification).
  So no client with the InsForge callback is created in this Google project.
- Separate work, own feature branch: a callback route on postsocial.xyz (for example
  `/oauth/google/callback`) that forwards to InsForge's Google callback, the same way the
  YouTube callback already works. Untested risk: InsForge's callback may check state or
  cookies tied to its own host. Test on dev first. Estimate: half a day to a day, plus one
  to two days if that check gets in the way.
- Once the route works and the brand is verified: create the sign-in client with the
  postsocial.xyz redirect, Aki puts its id and secret in InsForge Auth → Google, flip
  `GOOGLE_SIGNIN`, deploy on his word.
- To check during the submission: one forum report says the consent screen showed the
  domain instead of the app name and verification failed on the mismatch (unconfirmed).

Code and config changes (feature branch, tests, Aki's OK before pushing):

1. Privacy page: it says we ask for a single Google permission (`youtube.upload`) and
   never read channel data. Update it to name `youtube.readonly`, what we read (video
   views, likes, comment counts, subscriber count), how long we keep it, and the Google API
   Services User Data Policy "Limited Use" statement. Google checks this page against the
   scopes.
2. Dev settings: `youtube` in `ANALYTICS_PREVIEW_PLATFORMS` and the Adzo workspace id in
   `ANALYTICS_PREVIEW_WORKSPACES` (if not already), then reconnect @AdzoTest.
3. Consent screen: add `youtube.readonly` under Data Access; fill branding (name, logo,
   home, privacy, terms, authorized domain postsocial.xyz, support email).

Demo script (one video covers both scopes; Google wants the consent screen with the client
id visible in the address bar and the language set to English):

| Scene | On screen | Caption |
|---|---|---|
| 1 | postsocial.xyz home page, then sign in to Post Social | "Post Social: schedule and track posts across platforms" |
| 2 | Accounts → Connect YouTube | "Connecting a YouTube channel" |
| 3 | Google account chooser, then the consent screen; address bar shows the client id; both permissions listed | "OAuth consent screen: upload videos, view the channel's videos and stats" |
| 4 | Back in Post Social, channel @AdzoTest shows Connected | "Channel connected" |
| 5 | New post → pick a video → publish to YouTube | "youtube.upload: publishing a video the user chose" |
| 6 | The video live on YouTube | "The video on the user's channel" |
| 7 | Analytics page, YouTube filter: views, likes, comments, subscribers | "youtube.readonly: the channel's own video numbers" |
| 8 | Accounts → Disconnect YouTube | "Users can disconnect at any time; access is revoked" |

Submission text (draft):

> Post Social is a social media management app at https://www.postsocial.xyz. Users connect
> their YouTube channel to publish videos and to see how those videos performed.
>
> youtube.upload: uploads a video the user selected in Post Social to their own channel,
> with the title, description and privacy setting they chose. Nothing is uploaded without
> the user's action or schedule.
>
> youtube.readonly: reads the view, like and comment counts of the videos the user
> published through Post Social (videos.list, part=statistics), to show them on the user's
> Analytics page. We do not read watch history, playlists, subscriptions or other videos. A narrower scope can't do this: youtube.upload cannot read statistics,
> and no smaller YouTube scope returns per-video statistics for the user's own channel.
>
> Google user data is shown only to the user's own workspace, is not sold, not used for
> advertising, and not shared with anyone except YouTube itself. Users can disconnect at
> any time, which revokes our access and deletes the stored tokens.

Aki's steps: sign in to Google Cloud and to adzotest1@gmail.com, run QuickTime, upload the
video (an unlisted YouTube link is what Google asks for), Submit. Google usually replies by
email with questions; Claude drafts each answer.

When approved: `youtube` into prod `ANALYTICS_PLATFORMS`, redeploy, users reconnect once.

---

## 3. TikTok: `video.list`

**Status:** not started. Sandbox "Post-Social-test" already has `video.list`; @adzotest is
a sandbox test user.

| | |
|---|---|
| Asking for | `video.list` on the live app |
| Why | Official views, likes, comments and shares for a creator's own TikTok videos |
| Portal | developers.tiktok.com → Manage apps → Post Social |
| App | Post Social, App ID `7664698495021910023`; sandbox "Post-Social-test" |
| Code | Built (`ANALYTICS_SCOPES.tiktok`, worker read) |

Also in this visit: add prod's own callback
`https://syydd6ck.function2.insforge.app/connections/oauth/tiktok/callback` to the live
app's Login Kit redirect URIs, next to the Convex one. Changes to a live TikTok app go
through review, so it rides along with the `video.list` submission. After approval and
Aki's word: delete `TIKTOK_REDIRECT_URI` on prod, confirm a TikTok sign-in works, and only
then can the Convex deployment `vibrant-donkey-218` be paused.

Steps:

1. Confirm dev uses the sandbox app's credentials and asks for `video.list` for the Adzo
   workspace. TikTok has no "preview" route, so this is dev's `ANALYTICS_PLATFORMS`.
2. Post one test video to @adzotest through Post Social on staging (stays private).
3. Rehearse: reconnect @adzotest, check the numbers appear on Analytics.
4. Record, caption, draft, then fill the app review form up to Submit.

Demo script:

| Scene | On screen | Caption |
|---|---|---|
| 1 | Post Social staging, address bar visible, Accounts page | "Post Social: connecting a TikTok account" |
| 2 | Connect TikTok → TikTok sign-in as @adzotest | "Login Kit" |
| 3 | TikTok permission screen listing "Read your public videos" | "video.list: the creator allows Post Social to read their videos" |
| 4 | Back in Post Social, account Connected | "Account connected" |
| 5 | Analytics page, TikTok filter: the test video with views, likes, comments, shares | "video.list: the creator's own video numbers" |
| 6 | Post detail | "Shown only to the creator's workspace" |

Submission text (draft):

> Post Social is a social media management app. Creators connect TikTok to publish videos
> and to see how those videos performed. video.list is used to read the connected creator's
> own videos and their view, like, comment and share counts, which appear on the creator's
> Analytics page next to their other platforms. We read only the connected account's
> videos, refresh the numbers on a schedule (every few hours on day one, then daily, then
> weekly, stopping after 30 days), show them only to that creator's workspace, and do not
> sell or share them. The video shows the sign-in with the permission screen and the
> Analytics page. It was recorded on our staging site with the sandbox app.

Aki's steps: sign in to the TikTok developer portal and to @adzotest (code arrives in his
Gmail), run QuickTime, upload, Submit.

When approved: `tiktok` into prod `ANALYTICS_PLATFORMS`, redeploy, users reconnect once.

---

## 4. TikTok API for Business: Accounts API

**Status:** waits for `video.list` approval. Prep can start earlier.

| | |
|---|---|
| Asking for | A TikTok API for Business developer app with the "TikTok Accounts" scope (Organic API → Accounts API) |
| Why | Deeper TikTok analytics (reach, followers, audience) and comments on owned videos, for Business accounts |
| Portal | business-api.tiktok.com → developer registration → create app; then the Accounts API Access Application Form (required since 2026-03-20) |
| App | New; id recorded here once created |

Steps:

1. Aki signs in at business-api.tiktok.com (a TikTok for Business account under Pentridge
   Media). Claude fills developer registration: company, website, contact email.
2. Create the app: name "Post Social", description, callback
   `https://syydd6ck.function2.insforge.app/connections/oauth/tiktok-business/callback`
   (and dev's), scope request.
3. Fill the Accounts API access form. Draft answers: who we are, what a user does (connects
   a Business account a second time to unlock deeper stats and comment replies), which
   endpoints (profile and video insights, comment list and reply), data handling (own
   account only, workspace-only, no resale, deletion on disconnect).
4. A demo is likely asked for at app review; it needs the build below first.

Code (after access is granted, own feature branch): a second TikTok connection type for
Business accounts, insight reads in the worker, and comments in Inbox. @adzotest would need
to become a Business account, or we add a second test account.

Aki's steps: sign in, Submit on the registration, the form and the app.

---

## 5. LinkedIn: Community Management API

**Status:** not started. No dependency on the others, so it can run in parallel with Google
and TikTok.

| | |
|---|---|
| Asking for | Community Management API, Development tier first, then Standard tier |
| Why | Analytics for personal profiles (`r_member_postAnalytics`) and Company Pages, posting to Company Pages, and a comments Inbox for Company Pages |
| Portal | linkedin.com/developers/apps |
| App | New app under the Pentridge Media Page. LinkedIn requires this product to be the only one on its app, so the current app (`772hbqs7d0agxw`) stays as it is for sign-in and personal posting. Id recorded here once created |

Prerequisites: Aki is an admin of the Pentridge Media LinkedIn Page (to verify the app);
company legal name, registered address and a business email (aki.b@pentridgemedia.com) for
the access form; privacy policy URL.

Steps:

1. Create the app "Post Social Pages" on the Pentridge Media Page, logo, privacy URL.
2. Verify the app from the Page (a link Aki opens as Page admin).
3. Request Community Management API. Fill the Development tier form: company details, use
   case (social media management: publish, analytics, comment management for members and
   the Pages they administer).
4. Once Development tier lands: add redirect URLs for dev and prod, Aki adds the new client
   id and secret to InsForge dev.
5. Build on dev (own feature branch): connect a Company Page, post to it, read post and
   follower analytics, comments in Inbox. Test with the "Adzo Test" Page.
6. Standard tier application: needs a screen recording of the working app. Script below.

Demo script (Standard tier, after the build):

| Scene | On screen | Caption |
|---|---|---|
| 1 | Accounts → Connect LinkedIn Page | "Connecting a LinkedIn Page" |
| 2 | LinkedIn sign-in and permission screen | "The member grants access to the Pages they administer" |
| 3 | Pick Page "Adzo Test" | "Choosing which Page to connect" |
| 4 | Publish a post to the Page; show it on LinkedIn | "Publishing as the Page" |
| 5 | Analytics: impressions, reactions, comments, followers | "The Page's own post analytics" |
| 6 | Inbox → Comments: read and reply; reply appears on LinkedIn | "Reading and replying to comments on the Page's posts" |

Development tier use-case text (draft):

> Post Social (https://www.postsocial.xyz) is a social media management app by Pentridge
> Media. Members connect their LinkedIn profile and the Company Pages they administer to
> schedule and publish posts, see how those posts performed, and read and reply to comments
> on their Page's posts from one inbox. We act only for the signed-in member and the Pages
> they administer, only on their instruction, and we do not sell or share LinkedIn data.

Aki's steps: sign in to LinkedIn, verify the app from the Page, Submit both forms, add the
secrets to InsForge.

---

## No application needed (build only)

| Platform | Work |
|---|---|
| Bluesky | Read official counts (likes, reposts, replies, quotes) from the Bluesky API. Free, no review |
| X | Read official counts on Pay Per Use. Every read costs money, so pick a refresh rate and a per-workspace cap first |

Not part of this plan's submissions; listed so they aren't lost.

---

## Order of work

1. Meta status check (10 minutes, read only).
2. Google: privacy page change, consent screen, demo, submit.
3. TikTok `video.list`: demo on sandbox, submit with the new callback.
4. LinkedIn: create app and send the Development tier form (in parallel with 2 and 3).
5. Meta: new request for anything missing, once the current review ends.
6. TikTok Accounts API: registration and form after `video.list` is approved.

## Open questions for Aki

1. Google decision A: submit without `youtube.force-ssl` now (recommended), or build
   YouTube comments first?
2. ~~Google decision B~~ Decided: sign-in is separate, after the submission, through a
   postsocial.xyz callback route.
3. Video folder: `~/Documents/Post Social reviews/` fine?

## Log

- 2026-11-10: Plan written. Read the handoff, environments and task files. Checked code:
  analytics scopes for Instagram, Threads, TikTok and YouTube are built; no YouTube
  comments code on any branch; the privacy page names only `youtube.upload`. Nothing
  submitted, no portal opened yet.
- 2026-11-10: Aki agreed the approach. Google sign-in is its own step after the Google
  submission, with its callback on postsocial.xyz, because Google verifies redirect domains.
- 2026-11-10: Meta checked (read only). `instagram_business_manage_insights`,
  `threads_manage_insights` and `read_insights` are all in the 2026-11-04 review. The
  "Post Social stats" login configuration exists. No Meta work needed until Meta replies.
- 2026-11-10: Google started. Branch rebased onto dev. Privacy page now names
  `youtube.readonly`, says what is read (view, like, comment counts of videos published
  through Post Social), retention, and the Limited Use statement. Typecheck and lint pass;
  tests pass except `worker/src/publish/bluesky.test.ts` "shrinks images over 1 MB", which
  times out at 5s on this Mac under load and passes with a longer timeout (not related).
  The Google account signed in to the browser pane has no access to project 312431664994.
- 2026-11-10: Google Cloud read (read only), as aki.b@pentridgemedia.com. In the browser
  pane that account is the second Google sign-in: always open console links with
  `?authuser=1&project=clippost-app` and confirm the account before reading. Never use the
  Questus account. Project "Post Social", id `clippost-app`, number 312431664994, under
  pentridgemedia.com.
  - Branding: already filled. Name "Post Social", a logo is uploaded, home
    https://www.postsocial.xyz/, privacy /privacy, terms /terms, authorized domain
    postsocial.xyz, support and developer email aki.b@pentridgemedia.com.
  - Audience: External, In production, 2 of 100 users used.
  - Data Access: only `youtube.upload` is listed (sensitive, approval required). The
    justification box and the demo video link are empty. `youtube.readonly` is not added.
  - Clients: one, "Post Social Web" (web application, created 2026-05-03).
  - Google's note on that page: record the demo on staging, not on production traffic, and
    the "unverified app" screen must be visible in the video.
  - Still to read: the client's redirect URIs (is staging's callback allowed?) and the
    Verification Center status.
- 2026-11-10: With Aki's OK, added `youtube.readonly` under Data Access and saved (first
  save errored, second saved; confirmed after reload: `youtube.upload` and
  `youtube.readonly` are both listed). Nothing submitted.
  - Verification Center: **branding is already verified** and shown to users. Data access
    is not verified. So this submission is scopes only: justification text + demo video.
  - Client "Post Social Web" redirect URIs: `https://www.postsocial.xyz/oauth/youtube/callback`,
    `http://localhost:3333/oauth/youtube/callback`, and the two older `/api/auth/youtube/callback`
    ones. JavaScript origin `https://www.postsocial.xyz`. **No staging address.** The
    website's callback route finishes the sign-in on the same site it lands on, so YouTube
    can be connected on prod or on localhost:3333 (dev backend), not on the staging site.
  - Where to record the YouTube demo (open): (a) localhost:3333 against dev, no portal
    change; or (b) put staging on `staging.postsocial.xyz` and add its callback, which keeps
    every redirect on our verified domain. A vercel.app redirect is not an option: Google
    checks redirect domains.
- 2026-11-10: Aki chose the local dev site for the YouTube demo. Dev settings read (not
  changed): `GOOGLE_REDIRECT_URI` is `http://localhost:3333/oauth/youtube/callback`;
  `ANALYTICS_PLATFORMS` is `instagram,facebook,threads,youtube,tiktok`, so every dev
  workspace already asks for `youtube.readonly` and `video.list` (no preview settings
  needed for YouTube or TikTok); `ANALYTICS_PREVIEW_PLATFORMS` is `facebook,threads` for
  workspace 88f3deeb (not the Adzo workspace). Local site runs from this worktree on
  port 3333 (`.env.local` is a symlink to the main checkout's, gitignored). Waiting for
  Aki to sign in to Post Social there with the staging test login.
- 2026-11-10: YouTube rehearsal on localhost:3333 (Aki signed in to Post Social). The Adzo
  workspace shows all 8 accounts connected. Analytics → Posts → YouTube lists 3 videos
  marked "Official", each with 0 views, 0 likes, 0 comments (e2e check uploads from today).
  Connect YouTube sends Google both scopes (`youtube.upload youtube.readonly`) with the
  localhost callback; stopped at Google's account chooser, nothing granted or changed.
  Before recording: one test video needs a few real views, a like and a comment so the
  Analytics scene shows numbers (Aki, from another account; the video must be public or
  unlisted). Ready to record once that's done.
- 2026-11-10: Aki watched, liked and commented on https://www.youtube.com/shorts/Dl-nyQkJht8.
  That Short is not one of the three the Adzo workspace published through Post Social
  (those are wdsfeJWuKBg, 9eW2QTZNmmk, 1P7tAGgRVTE), so Analytics can't show it. Refresh
  now was pressed once (2 left today); the three still show zeros. Needs engagement on one
  of those three instead.
- 2026-11-10 21:03 UTC: Aki watched, liked and commented on wdsfeJWuKBg. YouTube's own
  page shows 1 view and a like; the Short is public. Post Social still shows zeros: its
  last read was 21:00 UTC, just before the engagement, and a post can be re-read at most
  every 30 minutes, so the second Refresh now (21:02) did not re-read it. 1 refresh left
  today. Re-check after 21:30 UTC.
- 2026-11-11 04:48 UTC: Official YouTube read confirmed on localhost. wdsfeJWuKBg shows
  6 views, 1 like, 1 comment, marked "Official" (the app's own scheduled refresh picked it
  up; last updated 04:47 UTC). The other two Shorts show zeros. Ready to record the demo.
  Note: the browser pane loses the Post Social sign-in whenever the app or session
  restarts, so sign in, record and finish in one sitting.
- 2026-11-11 ~05:00 UTC: YouTube demo take recorded by Aki (QuickTime) on localhost:3333.
  Scenes captured, in order: Accounts → Connect YouTube → Google account chooser,
  unverified-app warning and permission screen (Aki, as adzotest1@gmail.com) → Accounts
  with "Connected YouTube channel." → Analytics overview and Posts for YouTube (6 views,
  1 like, 1 comment, Official) → Create: caption, test-short.mp4 from the library, Publish
  now → Logs showing "Published to YouTube channel · Live" → the channel's Shorts page with
  the new Short → Analytics Posts with 4 YouTube posts.
  - Reconnecting while connected kept the three earlier videos and their numbers.
  - Published one new public Short to @AdzoTest: "Post Social demo: a short published
    from Post Social to YouTube".
  - Not recorded: the Disconnect scene. Skipped on purpose so the test workspace keeps
    YouTube (the e2e publish tests use it). Can be a short add-on clip if Google asks.
  - To edit: the Google chooser lists Aki's other Google accounts by email; crop or blur
    that screen. Trim waits. Scale to 1080p, burn in captions.
- 2026-11-11: YouTube demo edited from Aki's two recordings (Desktop: "video 1 -
  youtube.mov", "youtube - video 2.mov"). Output:
  `~/Documents/Post Social reviews/youtube/post-social-youtube-scopes-demo.mp4`
  (87 s, 1920x1080, 30 fps, no audio, captions burned in, title card naming both scopes
  and the OAuth client id). Cut: every part with the Claude panel on screen, the passkey
  and password screens, the waits, Calendar. Aki's other Google accounts on the chooser
  are blurred; the address bar with `client_id` stays readable. Not yet reviewed by Aki,
  not uploaded.
  - Weak spot: Google's consent screen in this take says "Post Social already has some
    access. See the 2 services" and does not list the two permissions, because the test
    account had granted them before. If Google wants the permissions listed, re-record
    that one screen after removing Post Social at myaccount.google.com/permissions for
    adzotest1@gmail.com.
- 2026-11-11 ~05:25 UTC: Retake of the connect step, done by Claude at Aki's request.
  Removed Post Social under adzotest1@gmail.com → myaccount.google.com/connections
  (twice: the first screen recording was lost because stopping `screencapture` early
  discards the file; let `-V <seconds>` run out instead). Recorded with
  `screencapture -x -v -V 80` (captures the whole screen; Claude window in front, pane
  maximised; crop `3024:1701:0:160`). Aki clicked through Google's screens.
  - Google's consent screen now lists both permissions with checkboxes ticked ("Manage
    your YouTube videos", "View your YouTube account"), and the chooser shows only Adzo
    Test, so no blur is needed.
  - Video rebuilt (v2, 81 s): new opening from the retake, the rest from recording 2.
    The consent frame with both boxes ticked is held for 5 s so it can be read (it was
    on screen about 1.5 s live).
  - After the retake: YouTube is connected in the Adzo workspace, the 4 posts and their
    official numbers are intact.

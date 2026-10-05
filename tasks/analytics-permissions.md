# To do: get the post-stats permissions approved (bookmarked 2026-10-04)

Post stats (Phase 5D) are built and switched on for **dev only**. Prod shows no stats
anywhere until each platform approves its read permission. When you're ready, work through
this list. Nothing here is urgent for launch prep.

## 1. Add the permissions to each app (developer portals, dev settings only)

| Platform | Where | Permission / scope |
|---|---|---|
| Instagram | Meta app 2155585218350381 → Instagram use case → permissions | `instagram_business_manage_insights` |
| Threads | Meta app 920… → Threads use case → permissions | `threads_manage_insights` |
| Facebook Pages | Meta app 1322708666515720 → Facebook Login for Business → **new configuration for dev** that adds `read_insights` (keep prod's configuration unchanged), then set the dev secret `META_LOGIN_CONFIG_ID` to the new configuration id | `read_insights` |
| TikTok | TikTok developer portal → **sandbox** app → Login Kit scopes | `video.list` |
| YouTube | Google Cloud → OAuth consent screen → scopes | `https://www.googleapis.com/auth/youtube.readonly` |

## 2. Reconnect the dev accounts

On `http://localhost:3333/beta/accounts`, reconnect Instagram (@buildwithaiaki), the
Facebook Page, Threads, YouTube and TikTok, so each grants the new permission.

## 3. Post one fresh test post per platform

Through Post Social (Claude Code with the dev MCP is fine). The old Phase 4 test posts
were deleted, so stats need new ones. Check `/beta/stats` a few minutes later.

## 4. Record the review demos and submit

Per platform: fresh sign-in (remove the app from the account's website permissions first,
record in incognito), grant the permission, then show the Stats page with that post's
numbers. 1080p, burned-in captions, no narration. Claude drafts each submission's text;
you press Submit.

## 5. When each approval lands

1. Set that platform in prod's `ANALYTICS_PLATFORMS` secret (InsForge prod) and Vercel
   Production env, e.g. `instagram,threads`.
2. Redeploy prod: `functions:deploy -- prod api`, `functions:deploy -- prod connections`,
   `worker:deploy -- prod`, `deploy:prod`.
3. People reconnect that platform once to grant the permission.

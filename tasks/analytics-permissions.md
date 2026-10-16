# To do: get the post-stats permissions approved (bookmarked 2026-10-04)

Post stats (Phase 5D) read each platform's own API on **dev**. Until a platform approves its
read permission, prod can show the same Analytics page from posts' public pages instead
(ScrapeCreators); see "Public numbers until approval" below. When you're ready, work through
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
were deleted, so stats need new ones. Check `/beta/analytics` a few minutes later.

## 4. Record the review demos and submit

Per platform: fresh sign-in (remove the app from the account's website permissions first,
record in incognito), grant the permission, then show the Analytics page with that post's
numbers. 1080p, burned-in captions, no narration. Claude drafts each submission's text;
you press Submit.

## 5. When each approval lands

1. Set that platform in prod's `ANALYTICS_PLATFORMS` secret (InsForge prod) and Vercel
   Production env, e.g. `instagram,threads`.
2. Redeploy prod: `functions:deploy -- prod api`, `functions:deploy -- prod connections`,
   `worker:deploy -- prod`, `deploy:prod`.
3. People reconnect that platform once to grant the permission.

4. Remove that platform from prod's `ANALYTICS_PUBLIC_PLATFORMS` once its official numbers
   show up (keeping it in both fills gaps and covers failed reads, at one credit per read).

## Public numbers until approval

Settings (each environment; the website reads the two lists from its Vercel env too):

| Setting | Where | What |
|---|---|---|
| `ANALYTICS_PUBLIC_PLATFORMS` | InsForge secret + Vercel env | Platforms read from public pages, e.g. `instagram,threads,facebook,tiktok,youtube,linkedin,x`. Bluesky needs no key: put it in `ANALYTICS_PLATFORMS`. |
| `SCRAPECREATORS_API_KEY` | InsForge secret (worker) | Without it public reads are off. One credit per read. |
| `ADMIN_EMAILS` | Vercel env (prod) | Comma-separated emails that see the Data (official/public) column on prod. Dev shows it to everyone. |

What public pages give: TikTok views/likes/comments/shares/saves; Instagram likes/comments
(+views on Reels); Facebook reactions/comments/shares (+views on videos); Threads
likes/replies/reposts/quotes/shares; YouTube views/likes/comments; LinkedIn likes/comments;
X views/likes/replies/reposts/quotes/bookmarks. Public reads run every 3 hours on day one,
daily to day 7, weekly to day 30, then stop. Follower counts: once a day per account.

---
name: tiktok-post-id-rounding
description: TikTok post ids (19 digits) get rounded by JSON.parse, so new TikTok posts get a wrong live link and analytics marks them "deleted" — found 2026-10-20
metadata:
  type: project
  modified: 2026-10-20T04:19:29.573Z
---

Found 2026-10-20 (thread "analytics not reflecting recent posts"). TikTok's status API returns `publicaly_available_post_id` as a JSON number; 19-digit ids exceed JS safe integers, so worker/src/publish/tiktok.ts, worker/src/analytics/runner.ts (tiktokStatus) and platforms.ts store a rounded id. Example: @adzoai post of 2026-10-19 22:00 UTC (destination e544c8a5) saved as ...9785000, real id 7698502021669784846 (confirmed via ScrapeCreators profile list). Result: broken "View post" link, analytics read says "no longer on TikTok; may have been deleted", next_fetch_at NULL so it never retries. Same bug will hit the 8 "waiting to go public" TikTok rows once they resolve.

Also confirmed: Accounts table "Last 30 days" column = FOLLOWER change, falling back to change since first snapshot (2026-10-17) — not posts. "Posts" counts only posts with a stats read (fetched_at set). No TikTok post has ever had stats in prod.

FIXED in PR 65 (merged 2026-10-20): worker/src/json.ts parseJson keeps 16+ digit ints as strings; migration 20261020050000 repaired the row (now 67 views). Aki ran worker + api + db:dev + db:promote. Site deployed 2026-10-20 ~05:12 UTC (dpl_3FohhmepoFhPvSbb3UjiXeWiCKy3) — fully live. Lesson: db:promote refuses migrations not yet applied to dev — always tell Aki to run `npm run db:dev` before `db:promote`. Related: [[analytics-plan]], [[checks-live-database]].

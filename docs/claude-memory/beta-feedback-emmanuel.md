---
name: beta-feedback-emmanuel
description: Emmanuel Jones's first beta feedback (2026-10-14) — what the live data showed and which Aligno cards were filed
metadata:
  type: project
---

Emmanuel's prod workspace 359056e2-d84c-4ecb-bb9a-111f24845dc6 (Instagram @secondshootapp in profile "Second Shoot"; LinkedIn disconnected). Checked 2026-10-15 via read-only prod DB:
- Two Instagram posts (not LinkedIn) were sent via REST create_post 2026-10-14 20:53 UTC with no scheduled_at, so they went live at once. That is the documented contract ("publishes now unless draft:true"); unknown fields are silently ignored, so a typo also posts now.
- His LinkedIn "disconnect" was a manual two-step Disconnect from the web app by his own login, 15s after connecting — not token health. Likely confused by both accounts showing display name "Emmanuel Jones".
- Cards filed 2026-10-15 in Aligno Inbox (Source: From a user): P1 "Stop the API from posting right away when no time is given" (5f01b682); P2 "Show when a post went out, its link and its pictures on the post itself" (5da7a91d); P2 "Show each account's @handle in the API, not just its display name" (7fcb383e).
**How to apply:** the P1 change breaks "no time = post now" callers — needs changelog + heads-up to Emmanuel. See [[aligno-tracker]].
- 2026-10-15 12:14 UTC: sent the 'Post Social product update' email (PRs 48-50, lantern banner) to Emmanuel from akinyemi@postsocial.xyz, reply-to Pentridge; Resend id 01a13f7b-def9-7145-8036-58fc0761134c. Heads-up about drafts is done.

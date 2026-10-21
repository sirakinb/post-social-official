---
name: checks-live-database
description: How the scheduled checks read Post Social's live prod InsForge database (read-only rules, probe, tables and queries) — added 2026-10-14
metadata:
  type: reference
  modified: 2026-10-14T03:48:20.846Z
---

Aki said "update it" 2026-10-14 03:46 UTC: scheduled checks should read the live prod database. Part of [[scheduled-checks]].

Access WORKS since 2026-10-14 03:52 UTC (Aki added the host + key as network secret "Post Social InsForge prod"; probe returned 200 even in the existing session). Setup: the cloud environment (env_01DqGq52xchztASHjTqvsjA3, "Aligno") must allow syydd6ck.us-east.insforge.app and inject Post Social's prod InsForge API key as a network secret for it. Only sessions started after the change get it.
- Prod host: https://syydd6ck.us-east.insforge.app. NOT aid258ua.us-west.insforge.app (that's Aligno's own backend).
- Probe each run: GET https://syydd6ck.us-east.insforge.app/api/database/records/workspaces?select=id&limit=1. 200 means access. A proxy CONNECT 403 means the host isn't allowed. A 401/403 from InsForge means there's no key. A 404 means the path is wrong. If there's no access, say so in one line and skip the database steps; never guess.

Read-only rules:
- Use HTTP GET on /api/database/records/<table> with PostgREST filters (eq., lt., gte., in.(), is.null, select=, order=, limit=).
- Never POST/PATCH/DELETE, raw SQL, rpc or functions.
- Never select credentials.encrypted_payload or initialization_vector, or any token/secret column.
- Never paste personal data (emails, captions, names) into cards or digests; use counts, platforms and short ids.

Tables (from migrations/):
- publish_jobs: state queued|running|retry_wait|complete|failed|cancelled, attempt_count, next_attempt_at, lease_expires_at, last_error, destination_id, updated_at.
- destinations → connected_accounts (platform, health connected|needs_attention|disconnected).
- credentials: connected_account_id, access_token_expires_at, refresh_token_expires_at.
- posts: status draft..published|partially_published|failed|cancelled, scheduled_at.
- Also: data_deletion_requests, workspaces, api_keys, oauth_grants, media_assets.

Checks to run:
- Stuck: queued/retry_wait with next_attempt_at more than 30 min ago, or running with lease_expires_at more than 10 min ago.
- Failed: state=failed in the last 24h, grouped by last_error.
- Expiring logins: refresh_token_expires_at within 7 days, or, for LinkedIn only (no refresh tokens), access_token_expires_at within 7 days. Other platforms' short access tokens renew themselves.
- Accounts with health not "connected".

X credit is still not in the database, so it can't be checked.

Cloudflare R2, working since 2026-10-14 05:05 UTC. Aki added a read-only token (Account Analytics: Read + Workers R2 Storage: Read), injected for api.cloudflare.com. Account 5e9cbd18080d4f973442560e2140a3e0.
- The account holds other projects' buckets; only look at postsocial-media-prod and postsocial-media-dev.
- Sizes come from GraphQL r2StorageAdaptiveGroups.
- Baseline 2026-10-14: prod 915.9 MB / 151 objects, dev 367.8 MB / 28 objects.
- The worker runs on InsForge Compute, not Fly (the deploy script only uses flyctl as a tool), so no Fly token is needed.
- Known bug (card "Show scheduled posts as published once they go out", filed 2026-10-19, P1): scheduled posts stay posts.status='scheduled' after sending (worker's mark_post_sending CTE never runs). Don't refile; judge sends by publish_jobs/destinations, not posts.status.

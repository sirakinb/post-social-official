---
name: linkedin-x-bluesky-setup
description: State of adding LinkedIn, X and Bluesky posting (portal setup facts, pricing, decisions) as of 2026-10-10
metadata:
  type: project
  modified: 2026-10-10T03:54:23.632Z
---

- DB already allows platforms linkedin, x, bluesky (core-schema migration). Code still needed: sign-in/refresh/revoke in backend/lib/connections/platforms.ts + worker adapters in worker/src/publish/.
- Redirect URL pattern: {CONNECTIONS_BASE_URL}/oauth/<platform>/callback. Prod base https://syydd6ck.function2.insforge.app/connections, dev https://syydd6ck-zqc.function2.insforge.app/connections.
- LinkedIn (2026-10-10): app "Post Social" has openid, profile, email, w_member_social only = personal profile posting incl. video. Company association with Pentridge Media approved (Page verification only, NOT Page posting). Page posting needs Community Management API (Dev tier then Standard tier with screencast); may need its own app. No refresh tokens -> reconnect every 60 days. Secrets in InsForge as LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET. Aki pasted the secret in chat once and was told to regenerate it.
- X: no Basic/Pro subscriptions anymore; pay-per-use credits at console.x.com. Post $0.015, post with a URL $0.20 (docs.x.com pricing, checked 2026-10-10). Planned secrets X_CLIENT_ID / X_CLIENT_SECRET, OAuth 2.0 web app, read+write.
- Bluesky: no portal/approval; plan v1 = app passwords.
- Order changed by Aki 2026-10-10: one at a time, LinkedIn first, then Bluesky, then X. LinkedIn code committed on branch claude/add-linkedin-x-bluesky-qfzj3f (commit b428a8b), pushed as draft PR #23 (2026-10-10); next: Aki adds dev secrets, then deploy connections function + worker to dev and test. Related: [[post-social-roadmap]]

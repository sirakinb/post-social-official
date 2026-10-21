---
name: google-signin-hidden
description: Google sign-in button is hidden on Post Social sign-in/sign-up since 2026-10-21 until Post Social has its own Google OAuth app
metadata:
  type: project
  modified: 2026-10-21T01:11:50.157Z
---

Since 2026-10-21 (PR 70, live), the Google button is hidden on /beta/login and /beta/signup. The switch is `GOOGLE_SIGNIN = false` in src/lib/insforge/auth-rules.ts. Sign-up and sign-in are email-only for now.

**Why:** Google's consent screen said "InsForge" (InsForge's shared Google app). Aki wants it to say Post Social, and asked to remove the option until then.
**How to apply:** when Aki creates Post Social's own Google Cloud OAuth client and pastes the client ID and secret into InsForge's Google auth settings (prod), flip GOOGLE_SIGNIN to true and deploy. Tracked on Aligno card 096ccb99-e5a8-4ce5-a2b1-04290dd85946 (todo, filed 2026-10-21). Related: [[billing-open-signup-plan]].

Also 2026-10-21: Aki asked "are we live?" — yes (open sign-up + live billing). He chose to KEEP the "Beta" label for branding/strategic reasons for now ("Post Social / Beta" in src/app/beta/auth-card.tsx, /beta URLs). Leaving beta = remove label + changelog/launch post; /beta→/app URL move optional, later. Don't push it. Tracked on Aligno card 41b38c4a-a3c2-4837-9272-b614052290dc (todo, P3, filed 2026-10-21).

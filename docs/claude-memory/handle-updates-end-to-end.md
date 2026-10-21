---
name: handle-updates-end-to-end
description: Aki wants Claude to merge AND deploy updates itself (site, InsForge functions) whenever it can, not hand him deploy commands
metadata:
  type: feedback
  modified: 2026-10-15T11:57:19.808Z
---

Aki, 2026-10-15 (Aligno work picker thread), after being handed Mac deploy commands: "merge and deploy. You should always handle the updates when you can. you're connected to insforge, vercel, and cloudflare currently".

**Why:** he doesn't want to run deploy steps himself; cloud sessions have prod InsForge admin access (injected key for syydd6ck.us-east.insforge.app) and Vercel access.
**How to apply:** once Aki says merge/deploy, do the whole release from the cloud: merge PRs, deploy changed InsForge functions to prod via the admin API (GET /api/functions lists them; back up the current code from GET /api/functions/<slug> first), deploy the site via the Vercel API ([[mac-prod-deploy-blocked]]). Only ask him for steps that truly need his Mac (e.g. db:promote if no cloud route). Merges/deploys still need his word first.
Finding 2026-10-15: the site deploy via the Vercel API works from the cloud, but a PUT to prod InsForge /api/functions/<slug> was refused by the auto-mode classifier as [Production Deploy], even with Aki's in-thread "merge and deploy". The fix is an allow rule in the repo's .claude/settings.json (cloud threads honor permissions.allow there), likely for a dedicated cloud function-deploy script. It was offered to Aki as "do 1"; until that lands, Aki runs `scripts/deploy-function.sh prod <fn>` on his Mac (he did so for api + posts 2026-10-15 ~12:02 UTC; PRs 48-50 fully live, cards completed).
Finding 2026-10-16 (Analytics thread): writing prod InsForge secrets (POST /api/secrets) is refused by the classifier [Secret-Store Writes] even with Aki's in-thread "set the secrets, you have access"; reading a pasted key back out of the transcript is refused [Credential Leakage]. Vercel env writes (POST /v10/projects/<id>/env) work. So: Vercel env yes; InsForge secrets go to Aki (dashboard, or `scripts/insforge-env.sh`).

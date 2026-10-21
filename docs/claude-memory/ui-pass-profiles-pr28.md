---
name: ui-pass-profiles-pr28
description: State of PR 28 (UI pass, profiles, month calendar, Logs) as of 2026-10-10
metadata:
  type: project
  modified: 2026-10-10T20:10:48.541Z
---

- PR 28, branch claude/connections-profiles-light-mode-lml3z5. It holds:
  - Sidebar: Accounts first, then Create; no Home, no Stats; Media is reached from Create.
  - Separate API/MCP and Settings pages.
  - Calendar: Month view is the default.
  - Activity renamed to Logs, built on audit_events.
  - Profiles: migration 20261010150000_profiles.sql; profile changes go through connections-function routes and API/MCP tools.
- 2026-10-10: Aki ran db:dev, deployed the connections and api functions to dev, and ran test:db. I asked whether test:db passed and whether to merge.
- Deploy order matters: run the migration before deploying the functions, because /start writes oauth_states.profile_id. Prod needs the same order when the PR merges.
- 2026-10-10 21:28 UTC: PR 28 merged to main (Aki's OK). Aki ran the prod rollout (db:promote, connections + api to prod, worker prod) at 21:33 UTC. Web app needs `npm run deploy:prod` separately: vercel.json disables auto-deploy from main, so merging does NOT update postsocial.xyz.
- Open decision: per-plan monthly X post allowance (Aki thinking about it alongside business model). Launch blockers named: sign-up (disable_signup=true; invite-only recommended), regenerate LinkedIn secret, X credits top-up + cap, Stripe not built.
- Still open: light mode redo, only if time allows. Planned API/MCP tabs:
  - Codex: `codex mcp add` with OAuth.
  - Grok: grok.com connectors or the Grok CLI.
  - Meta Muse: the user pastes the MCP URL into a Muse chat.
- Keep both the Claude and Claude Code tabs, and both ChatGPT and Codex.
- Aki's rule (2026-10-10): every error a customer can't fix themselves points to support. Messages say just "contact support" (no email address, per Aki). The wording lives in backend/lib/support.ts; worker/src/publish/support.ts decides which publish failures the person can fix. New error paths should use these.
- Aki's taste for UI: organized, structured, "militant", simple, minimal. No rows of wrapping pill chips; prefer one fixed toolbar with dropdowns.
- Related: [[post-social-roadmap]]

- PR 30 (merged and rolled out 2026-10-11): Logs credit publishing steps to whoever made the post, and MCP clients' self-reported name (clientInfo at initialize) is saved to actors.client_name, so Logs show "Claude Code"/"Codex" with logos. A key only gets its agent name after that agent reconnects; the latest agent to connect on a key wins.
- Gotcha (2026-10-11): `npm run db:promote` backs up prod first, and InsForge allows only 5 manual backups. When the quota is full, promote stops before applying anything. Fix by deleting the oldest `before-promote-…`/`manual-…` backups (`scripts/insforge-env.sh prod backups delete <id>`); scheduled nightly backups can't be deleted. Check `npm run db:status:prod` after a promote.

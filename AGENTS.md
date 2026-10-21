# Agent guidelines

Claude (Claude Code) is the primary agent for this repository and may implement
frontend and backend work directly. No routing through Kimi or another CLI is
required.

- Implement UI code, styling, components, client-side behavior, frontend tests,
  bug fixes, refactors, dependency changes, and build/CI fixes directly.
- Before calling work done, review the full diff and run the relevant checks
  (`npm run typecheck`, `npm run lint`, `npm test`), and report failures honestly.
- Never expose secrets or `.env` contents. Confirm with the user before
  production operations, destructive actions, pushes, merges, or releases.

## Working with Aki (owner)

Read `docs/claude-handoff.md`, this file and `docs/environments.md` before starting
work.

- Aki (GitHub `sirakinb`) is on US Eastern time. Keep replies plain, short and
  conversational, and keep his manual steps to a minimum. When he must run
  commands, batch them into one block. Prefer preview URLs over local dev.
- Merges and prod deploys always wait for Aki's word in the thread. Once he says
  merge/deploy, do the whole rollout wherever connected services allow.
- Check with Aki before pushing. An Aligno card moved to In Progress authorizes a
  PR for it.
- You may start new sessions to run commands, including on Aki's Mac
  (`/Users/sirakinb/Documents/Thought-Social`), without asking. Use temporary git
  worktrees so his working copy isn't touched.
- Never put secrets in files, memory, or chat. Aki adds secrets to InsForge
  himself. If a key gets pasted in chat, tell him to rotate it.
- Real outbound emails to users need Aki's approval in the thread, and always cc
  aki.b@pentridgemedia.com.
- The cloud key for `syydd6ck.us-east.insforge.app` (Post Social prod) can write:
  keep to reads unless Aki asks. `aid258ua.us-west.insforge.app` is Aligno's
  backend, not Post Social: never touch it.
- Aligno cards follow the plain-language card style in `docs/claude-handoff.md`.

## Shipping process (every feature)

1. Work on a feature branch, never directly on `main`.
2. Write tests for the feature, then run `npm run typecheck`, `npm run lint`,
   `npm test` and `npm run build`. All must pass before anything is pushed. For
   database changes, also apply them to dev and run `npm run test:db`.
3. Batch work into one pull request per substantial chunk (roughly a phase or a
   large part of one); keep unfinished work as a draft.
4. Before asking to merge, review the full diff yourself for correctness and
   security (access rules, limits, secrets, input from users and links), fix what
   you find, and re-run the checks.
5. Merge to `main` only after checks pass, and with the owner's OK.

## Dev and prod (InsForge)

The repo is linked to the `dev` branch. Reach prod only through
`scripts/insforge-env.sh` / the `db:*` npm scripts. Schema changes are migration
files in `migrations/`, applied to dev first (`npm run db:dev`) and promoted from
`main` after review (`npm run db:promote`). Full process: `docs/environments.md`.

<!-- INSFORGE:START -->
## InsForge backend

This project uses [InsForge](https://insforge.dev): an all-in-one, open-source Postgres-based backend (BaaS) that gives this app a database, authentication, file storage, edge functions, realtime, an AI model gateway, and payments through one platform.

- **Project:** **post-social** (API base `https://syydd6ck.us-east.insforge.app`)
- **Skills:** these InsForge skills are installed for supported coding agents. Reach for them before implementing any InsForge feature instead of guessing the API:
  - `insforge`: app code with the `@insforge/sdk` client (database CRUD, auth, storage, edge functions, realtime, AI, email, and Stripe payments).
  - `insforge-cli`: backend and infrastructure via the `insforge` CLI (projects, SQL, migrations, RLS policies, storage buckets, functions, secrets, payment setup, schedules, deploys).
  - `insforge-debug`: diagnosing failures (SDK/HTTP errors, RLS denials, auth and OAuth issues) and running security or performance audits.
  - `insforge-integrations`: wiring external auth providers (Clerk, Auth0, WorkOS, Better Auth, etc.) for JWT-based RLS, or the OKX x402 payment facilitator.
  - `find-skills`: discovering additional skills on demand.
- **Credentials:** app code reads keys from `.env.local`; the CLI reads `.insforge/project.json`. Never hardcode or commit keys.

Key patterns:

- Database inserts take an array: `insert([{ ... }])`.
- Reference users with `auth.users(id)`; use `auth.uid()` in RLS policies.
- For storage uploads, persist both the returned `url` and `key`.
<!-- INSFORGE:END -->

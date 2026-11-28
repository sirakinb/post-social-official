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
- Never put secrets in files, memory, or chat. Aki adds secret values himself (AWS
  Secrets Manager for the backend, Vercel for the website). If a key gets pasted in
  chat, tell him to rotate it.
- Real outbound emails to users need Aki's approval in the thread, and always cc
  aki.b@pentridgemedia.com.
- The cloud key for `syydd6ck.us-east.insforge.app` (Post Social's old prod on
  InsForge, kept idle as the way back) can write: keep to reads unless Aki asks.
  `aid258ua.us-west.insforge.app` is Aligno's backend, not Post Social: never touch it.
- Aligno cards follow the plain-language card style in `docs/claude-handoff.md`.

## Shipping process (every feature)

1. Work on a feature branch, never directly on `main`.
2. Write tests for the feature, then run `npm run typecheck`, `npm run lint`,
   `npm test` and `npm run build`. All must pass before anything is pushed. For
   database changes, also run them on a local Postgres set up like the AWS one
   (`npm run db:local`, then `npm run test:pg`). For changes under `infra/aws/`, run
   its own checks (`npm run typecheck`, `npm test`, `npm run synth` in that folder).
   Anything a person can do in the app, their AI agent must be able to do too:
   add or update the feature's entries in `backend/lib/api/operations.ts` (which
   generates the REST API, MCP tools, OpenAPI and API docs) with tests, and say
   in the PR which agent tools changed. Only connecting social accounts and
   entering a card stay web-only.
3. Batch work into one pull request per substantial chunk (roughly a phase or a
   large part of one); keep unfinished work as a draft.
4. Before asking to merge, review the full diff yourself for correctness and
   security (access rules, limits, secrets, input from users and links), fix what
   you find, and re-run the checks.
5. Merge to `main` only after checks pass, and with the owner's OK.

## Dev and prod (AWS)

Since 2026-11-26 both environments run on AWS (account 039612844713, us-east-1): the API
(`backend/`, one Node service), the worker (`worker/`) and a private Postgres 15 each. The
website stays on Vercel. What runs where: `infra/README.md`. Full process:
`docs/environments.md`.

- **Deploys.** A merge to `dev` that touches the backend deploys AWS dev by itself
  (`.github/workflows/deploy-aws-dev.yml`). A merge to `main` releases prod
  (`.github/workflows/release.yml`): migrations, then the API and the worker, then the
  website. The services are never deployed to prod by hand.
- **Schema changes** are migration files in `migrations/`, never edited once applied
  anywhere. The dev deploy applies them to AWS dev; the release applies them to prod.
  The databases accept no connection from outside AWS, so never plan on reaching one
  from a laptop or a GitHub runner.
- **The AWS setup is code** in `infra/aws/` (AWS CDK; its README lists every stack).
  Stack changes are deployed from Aki's Mac (`npx cdk diff`, then `npx cdk deploy`, with
  the `postsocial` profile), always after reading the diff and with his OK.
- **Never two workers on one environment.** Two would renew the same platform tokens
  and publish the same posts.
- **Watching it.** The CloudWatch dashboard `postsocial-overview`; alarms named
  `postsocial-prod-*`, which email Aki through the topic `postsocial-prod-alerts`; logs
  in `/postsocial/<env>/api` and `/worker` (30 days). A nightly dump of prod's database
  lands in the backup bucket (`docs/environments.md`, "Nightly backups to S3"). To look at
  tables and rows: `npm run db:view -- <dev|prod>`, a read-only login through a private
  tunnel (`docs/environments.md`, "Looking at the data").
- **Settings.** Each service reads one JSON secret, `postsocial/<env>/api` or
  `/worker`. Names only in the repo, never values.

## InsForge (the old backend, being wound down)

Until the move, everything above ran on [InsForge](https://insforge.dev) (project
`post-social`, `https://syydd6ck.us-east.insforge.app`; dev is its branch `syydd6ck-zqc`).
It is kept as the way back until about 2026-12-10, then wound down and its code removed.

- InsForge prod's database and functions are idle and untouched. Don't deploy to them,
  and never start a worker there.
- Feature-branch previews of the website still read InsForge dev. `scripts/insforge-env.sh`
  and the `db:*` npm scripts talk to InsForge, not to AWS.
- The InsForge skills (`insforge`, `insforge-cli`, `insforge-debug`,
  `insforge-integrations`) are still installed. Use them only for work on that fallback;
  new backend work is plain Node and Postgres in `backend/` and `worker/`.
- Code that still names InsForge (`src/lib/insforge/`, `backend/functions/`,
  `NEXT_PUBLIC_INSFORGE_URL`) is the fallback path. Leave it working until the wind-down.

# Environments

| | Prod | Dev |
|---|---|---|
| InsForge | project `post-social` | branch `dev` (schema-only) of `post-social` |
| API base | `https://syydd6ck.us-east.insforge.app` | `https://syydd6ck-zqc.us-east.insforge.app` |
| Dashboard | https://insforge.dev/dashboard/project/33078020-21bd-4dcc-b3b5-c8033c84a097 | branch of the same project |
| Vercel | Production | Preview |

Vercel environment variables (set in the Vercel project, not in git):

| Variable | Preview | Production |
|---|---|---|
| `NEXT_PUBLIC_APP_ENV` | `development` | `production` |
| `NEXT_PUBLIC_INSFORGE_URL` | dev API base | prod API base |
| `NEXT_PUBLIC_INSFORGE_ANON_KEY` | dev anon key | prod anon key |
| `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CONVEX_SITE_URL` | same Convex deployment | same Convex deployment |

**Warning: previews use live data until Phase 1.** There is only one Convex deployment,
and it holds the real accounts and posts. A PR preview reads and writes that same data,
so editing or approving a post in a preview affects the real one. Do not invite testers
to previews until the web app runs on InsForge, where previews use the dev branch.
Previews show an amber badge with the environment, the InsForge host and
"LIVE Convex data"; production shows none.

This folder is linked to **dev** by default. Keys live in `.insforge/project.json` and
`.env.local`, both gitignored. Never commit them.

## Talking to an environment

Always go through the wrapper. It switches the link to prod only for one command,
then switches back to dev.

```bash
scripts/insforge-env.sh dev  db migrations list
scripts/insforge-env.sh prod db migrations list   # asks you to type "prod"
```

On prod, read-only commands (lists, logs, diagnostics, `secrets get`) run from any
branch. Anything that changes prod, such as deploying a function, only runs from a
`main` that matches GitHub. The CLI version is pinned in the script so dev and prod are
changed by the same tool.

Do not use `INSFORGE_PROJECT_ID` to pick an environment: the CLI ignores it for
database commands and silently hits whichever environment is linked.

## Dev to prod

Git is the source of truth. Schema changes are SQL files in `migrations/`, applied
in order to dev, then to prod, exactly the same files.

1. **Write the change on a feature branch.**
   `npm run db:new -- <name>` creates `migrations/<version>_<name>.sql`.
2. **Apply to dev and test.** `npm run db:dev` applies pending migrations to dev, and
   `npm run config:dev` applies `insforge.toml` (sign-up, password policy, redirects).
   `npm run test:db` runs the database tests against dev: they create throwaway users
   and workspaces, check access rules, and delete everything afterwards. They refuse to
   run unless the folder is linked to dev.
3. **Review.** Push, open a pull request, CI runs checks.
   Fix findings, then merge to `main` with the owner's OK.
4. **Promote.** On `main`, in sync with GitHub: `npm run db:promote`. It refuses to
   run from any other branch, refuses if any migration in git was never applied to
   dev, lists what prod is missing, and asks you to type `prod` before applying it.
   Before applying anything it takes a named backup of prod
   (`before-promote-<date>-<commit>`) and waits for it; if the backup fails, nothing is
   applied. InsForge keeps only the latest nightly backup, so this restore point is what
   protects us from a bad migration. `npm run db:backup:prod` takes one by hand (also
   only from a synced `main`).
   It then shows any differences between `insforge.toml` and prod's settings and asks
   again before applying them.
5. **Deploy the web app.** Vercel builds a preview for every pull request (pointing at
   dev). Merging to `main` does not deploy production (set in `vercel.json`).
   Production goes out only with the owner's OK, via `npm run deploy:prod`, which
   refuses to run unless you are on a clean `main` that matches GitHub.
6. **Redeploy code.** Functions and the worker are deployed to each environment
   separately; deploy prod after the migration lands.

Rules:
- Never edit a migration that has been applied anywhere. Write a new one.
- Never change prod schema by hand (dashboard or `db query`). If it happens, write a
  migration that matches, so dev and prod stay identical.
- Data never moves between environments. Dev uses its own test data.

We do not use `branch merge` to promote. A merge leaves the branch dormant, and the
only way to reuse it is `branch reset`, which rewinds dev to the day it was created
and drops every migration since. Replaying git migrations keeps dev long-lived.
If dev ever drifts, reset it and run `npm run db:dev` to replay all migrations.

## Accounts

Public sign-up is off. Accounts are created with a script; the password is typed in when
it runs and never stored:

```bash
npm run account:create -- dev owner --email you@example.com --name "Your Name" --workspace "Workspace Name"
npm run account:create -- dev reviewer --email reviewer@example.com --name "Reviewer" --workspace-slug workspace-name
```

Run it in a Terminal window: it needs typed input, which the `!` prefix in Claude Code
cannot give. Use `prod` instead of `dev` for prod (asks you to type `prod`). The new web app runs at
`/beta` (sign-in at `/beta/login`) until it replaces `/app` at launch.

## TikTok sign-in and photo posts

- **Sign-in address.** TikTok's live app has only approved the old Convex callback
  (`https://vibrant-donkey-218.convex.site/api/oauth/tiktok/callback`). Until it approves
  prod's own address, prod sets `TIKTOK_REDIRECT_URI` to that Convex address and Convex
  (`TIKTOK_FORWARD_URL`) forwards every TikTok sign-in it didn't start to
  `https://syydd6ck.function2.insforge.app/connections/oauth/tiktok/callback`. Once TikTok
  approves prod's address, delete `TIKTOK_REDIRECT_URI` on prod.
- **Photo posts.** TikTok fetches photos itself, only from a verified domain and without
  following redirects, so it reads them from `https://www.postsocial.xyz/tiktok-media/...`
  (the website passes a signed storage link through). `postsocial.xyz` is verified in
  TikTok's portal for both the live app and the sandbox (TXT records on the root domain;
  `www` is a CNAME and can't hold one). Dev uses the same website address.

## LinkedIn sign-in

- **Secrets.** `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET`, on the `connections`
  function (sign-in, disconnect) and the worker (posting), in each environment.
- **Redirect URLs** (LinkedIn app, Auth tab): `{CONNECTIONS_BASE_URL}/oauth/linkedin/callback`
  for dev and prod, i.e. `https://syydd6ck-zqc.function2.insforge.app/connections/oauth/linkedin/callback`
  and `https://syydd6ck.function2.insforge.app/connections/oauth/linkedin/callback`.
- **Permissions.** `openid`, `profile` and `w_member_social`: posting to the member's own
  profile. Company Pages need the separately reviewed Community Management API
  (`w_organization_social`). Without a refresh token, access lasts 60 days and the account
  is flagged to reconnect when it runs out.

## Bluesky sign-in

Bluesky has no developer app to register. Our app is described by a page we serve, and
that page's address is our client id:
`{CONNECTIONS_BASE_URL}/oauth/bluesky/client-metadata.json` (with our public key at
`/oauth/bluesky/jwks.json`). It uses the official atproto OAuth (pushed requests, PKCE,
DPoP-bound tokens, `private_key_jwt`), so nobody types a password into Post Social.

- **Secret.** `BLUESKY_CLIENT_JWK`: an ES256 private key as a JWK with a `kid`, one per
  environment, on the `connections` function and the worker. Create and store it in one
  step, without it being shown:
  `scripts/insforge-env.sh dev secrets add BLUESKY_CLIENT_JWK "$(node -e 'const c=require("crypto");const {privateKey}=c.generateKeyPairSync("ec",{namedCurve:"P-256"});console.log(JSON.stringify({...privateKey.export({format:"jwk"}),kid:c.randomUUID().slice(0,8)}))')"`
  Replacing it signs every Bluesky account out (their tokens are tied to our key), so
  people reconnect.
- **Permissions.** `atproto transition:generic`: post and upload media for the account.
  Access lasts minutes and is renewed when used; each refresh token works once, so the
  worker holds the credential's lease while renewing.
- **Accounts.** Connecting asks for the handle, which finds the account's own server;
  left empty, sign-in starts at bsky.social.

## X sign-in

- **App** (console.x.com, the project's app → User authentication settings): app
  permissions **Read and write**, type **Web App, Automated App or Bot** (a confidential
  client), callback URLs `{CONNECTIONS_BASE_URL}/oauth/x/callback` for dev and prod
  (`https://syydd6ck-zqc.function2.insforge.app/connections/oauth/x/callback` and
  `https://syydd6ck.function2.insforge.app/connections/oauth/x/callback`), website
  `https://www.postsocial.xyz`.
- **Secrets.** The OAuth 2.0 `X_CLIENT_ID` and `X_CLIENT_SECRET` (not the API key and
  secret), on the `connections` function and the worker, in each environment.
- **Permissions.** `tweet.read tweet.write users.read media.write offline.access`. Access
  lasts two hours and is renewed when used; each refresh token works once (lease, as for
  Bluesky).
- **Cost.** X bills the app's prepaid credits per request: about $0.015 per post and $0.20
  for a post with a link, $0.01 for the profile read at each connection, $0.005 per image
  description. No stats are read (reads are billed too). Set a spending cap in the
  console. When credits run out, posts fail with a plain "X credits ran out" message.

## Media storage, functions and the worker

| | Dev | Prod |
|---|---|---|
| R2 bucket | `postsocial-media-dev` (private) | `postsocial-media-prod` (private) |
| Uploads allowed from | `http://localhost:3333`, `https://post-social-*-app-build-26.vercel.app` | `https://www.postsocial.xyz`, `https://postsocial.xyz` |
| Worker | `post-social-worker` on InsForge Compute, always on, 1 GB | same, 1 GB |

- Media files live in Cloudflare R2 and are never public: browsers upload with short-lived
  signed part links, and readers get short-lived signed links.
- The R2 key is a Cloudflare token limited to one bucket. It is stored only as InsForge
  secrets (`R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`), plus
  `WEB_APP_ORIGINS` for the browser origins allowed to call functions.
- Functions are bundled and deployed with `npm run functions:deploy -- <dev|prod> <name>`
  (for example `media`). Branches do not carry function code, so deploy to each environment.
- The worker (`worker/`) processes media jobs and runs the retention and orphan sweeps.
  Deploy with `npm run worker:deploy -- <dev|prod>`; it reads its settings from that
  environment's secrets and must stay `--always-on` (it gets no web traffic to wake it).
  InsForge Compute has no log viewer yet; failed jobs keep their error in
  `media_jobs.last_error`.

Before media goes to prod: create `postsocial-media-prod` with CORS for the prod web
origin, a bucket-scoped token stored as prod secrets, set prod `WEB_APP_ORIGINS`, then
deploy the `media` function and the worker to prod after `db:promote`.

## REST API and MCP server

The `api` function serves the REST API (`/v1/...`, description at `/v1/openapi.json`), the
MCP server (`/mcp`) and key management for the web app (`/keys`). Deploy it like the
other functions: `npm run functions:deploy -- <dev|prod> api`. It uses the existing
secrets (database, R2, `WEB_APP_HOME`, `WEB_APP_ORIGINS`).

The website gives it public addresses through rewrites in `next.config.ts`:
`https://www.postsocial.xyz/api/v1/...` and `https://www.postsocial.xyz/mcp`. They need
`API_BASE_URL` in the web environment (the function URL plus `/api`):

| | Prod (Vercel Production) | Dev (Vercel Preview, `.env.local`) |
|---|---|---|
| `API_BASE_URL` | `https://syydd6ck.function2.insforge.app/api` | `https://syydd6ck-zqc.function2.insforge.app/api` |

Rewrites are read at build time, so redeploy the site after changing it.

People create keys at `/beta/keys`. Test keys (`ps_test_...`) can do everything except
publish or schedule. Keys act only within their own workspace and appear by name in the
audit log. Not yet built: per-key rate limits (Phase 7) and revoking a person's keys when
they leave a workspace (Phase 5C).

## Sign-in for AI apps (OAuth)

ChatGPT, the Claude app, Claude Code, Cursor and other MCP apps can connect by signing in
instead of using a key: add `https://www.postsocial.xyz/mcp` as a connector (use `www`; the
bare domain redirects). The app discovers sign-in from the MCP server's 401 reply, registers
itself, and sends the person to `/oauth/authorize` (the consent page at `/beta/authorize`).
The issuer is the site in `WEB_APP_HOME` (dev: `http://localhost:3333`), so on dev test with
the local site. Discovery, registration, token and revocation addresses are rewrites to the
`api` function, like `/mcp`. Codes last 10 minutes, access tokens 1 hour, refresh tokens 60
days and rotate on every use. The worker's hourly sign-in sweep removes expired codes and
tokens and app registrations that were never approved within 30 days. People disconnect
apps under API keys, Connected apps.

## CLI, Claude Code plugin and docs

- `cli/` is the `postsocial` npm package (one bundled file, no dependencies). Build with
  `cli/build.sh`; try it against dev with `node cli/dist/postsocial.mjs --base-url
  http://localhost:3333 <command>`. Its commands come from the server's OpenAPI document.
  **Not published yet:** publishing needs the owner's npm account (`npm login`, then
  `cd cli && npm publish` after a build). Decide the license first.
- `integrations/claude-code/` is the Claude Code plugin (MCP server + `post-social` skill)
  and a marketplace file. `claude plugin validate integrations/claude-code` checks it.
  **Not distributed yet:** a marketplace must live in a public GitHub repo (this one is
  private), e.g. `postsocial/claude-code`.
- `/docs` (setup for Claude, ChatGPT, Claude Code, Cursor, the CLI and REST) and
  `/llms.txt` are generated from the operations list, like the API itself.


## Known limits (security review, 2026-10-05)

- **InsForge sign-in has no throttling of its own.** Our website limits sign-in and
  password-reset attempts (per visitor, per email and address), but the InsForge auth API
  is public and anyone can call it directly; 26 rapid wrong-password attempts on dev all
  answered normally. Until InsForge adds limits, rely on the password policy (12+
  characters with a number) and closed sign-up. Must be solved before public sign-up.
- **Dev allows a wildcard origin** for Vercel previews (`WEB_APP_ORIGINS` on dev). A
  stranger could register a matching Vercel name; it only affects dev, which holds test
  data. Prod lists exact addresses only; never add a pattern there.

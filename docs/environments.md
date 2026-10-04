# Environments

| | Prod | Dev |
|---|---|---|
| InsForge | project `post-social` | branch `dev` (schema-only) of `post-social` |
| API base | `https://syydd6ck.us-east.insforge.app` | `https://syydd6ck-zqc.us-east.insforge.app` |
| Dashboard | https://insforge.dev/dashboard/project/33078020-21bd-4dcc-b3b5-c8033c84a097 | branch of the same project |
| Vercel | Production | Preview |

This folder is linked to **dev** by default. Keys live in `.insforge/project.json` and
`.env.local`, both gitignored. Never commit them.

## Talking to an environment

Always go through the wrapper. It switches the link to prod only for one command,
then switches back to dev.

```bash
scripts/insforge-env.sh dev  db migrations list
scripts/insforge-env.sh prod db migrations list   # asks you to type "prod"
```

Do not use `INSFORGE_PROJECT_ID` to pick an environment: the CLI ignores it for
database commands and silently hits whichever environment is linked.

## Dev to prod

Git is the source of truth. Schema changes are SQL files in `migrations/`, applied
in order to dev, then to prod, exactly the same files.

1. **Write the change on a feature branch.**
   `npm run db:new -- <name>` creates `migrations/<version>_<name>.sql`.
2. **Apply to dev and test.** `npm run db:dev` applies pending migrations to dev.
   Test the feature against dev with test social accounts.
3. **Review.** Push, open a pull request, CI runs checks, Greptile reviews.
   Fix findings, then merge to `main` with the owner's OK.
4. **Promote.** On `main`, in sync with GitHub: `npm run db:promote`. It refuses to
   run from any other branch, shows what dev and prod have applied, and asks you to
   type `prod` before applying the pending migrations.
5. **Redeploy code.** Functions and the worker are deployed to each environment
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

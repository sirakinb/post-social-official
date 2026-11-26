# Post Social on AWS

Post Social's AWS setup, written as code with the AWS CDK (TypeScript). Nothing in AWS is
clicked together by hand: this folder describes it, and a deploy makes AWS match.

Account `039612844713`, region `us-east-1` (Virginia). The plan and where we are in the move
from InsForge: `tasks/aws-migration.md`. What runs where today: `infra/README.md`.

**No secrets live here.** Settings are created empty and filled in by hand in AWS.

## What it creates

| Stack | What is in it | Rough cost |
|---|---|---|
| `PostSocialFoundation` | The network (2 zones, public subnets for containers, isolated subnets for databases, no NAT gateway), network logs, the image registry (`postsocial/api`, `postsocial/worker`), the container cluster, and the two roles GitHub deploys with | Cents a month |
| `PostSocialEdge` | One public load balancer shared by dev and prod, and the HTTPS certificate for `api.postsocial.xyz` and `api-dev.postsocial.xyz` | About $25 a month |
| `PostSocialData-dev` | Dev's Postgres 15 database (private, encrypted), the firewall groups for its API and worker, its settings (`postsocial/dev/api`, `postsocial/dev/worker`), the keys made inside AWS (database logins, the sign-in key) and logs | About $17 a month |
| `PostSocialData-prod` | The same for prod, with deletion protection and 7 days of automatic backups | About $16 a month |
| `PostSocialServices-dev` | Dev's API (1 container behind the load balancer at `api-dev.postsocial.xyz`), its worker (running since 2026-11-26, when dev's website moved to this backend), the migration task, the task that fills the database from InsForge, and what dev's GitHub role may roll out | About $23 a month |
| `PostSocialServices-prod` | The same for prod: 2 API containers at `api.postsocial.xyz` and a larger worker | About $40 a month |

The services are their own stack per environment, so a service change can never replace a
database. Costs are list prices for containers running all month, each with a public address.

## Choices worth knowing

- **Containers get public addresses, in public subnets.** That avoids a NAT gateway (about
  $33 a month). Their firewall group lets in only the load balancer.
- **Databases have no public address** and accept only the API and worker of their own
  environment. Migrations and restores run from inside the network.
- **Dev and prod share the load balancer and the registry**, nothing else. Prod runs the
  exact image dev tested. The load balancer is its own stack so an environment deploy can't
  change it.
- **GitHub deploys without stored keys.** `postsocial-github-deploy-dev` trusts only the `dev`
  branch (and the `Development` environment, which GitHub limits to `dev`);
  `postsocial-github-deploy-prod` trusts only `main` (and `Production`). Today they can push
  images and nothing else.
- **One database zone for now.** A standby (Multi-AZ) roughly doubles the database cost; turn
  it on once there are paying users.
- **The stack decides the shape, the deploy decides the build.** Sizes, settings and firewall
  rules live here. Which commit's images run is recorded by the deploy workflow in
  `/postsocial/<env>/image-tag` (Parameter Store) and read back at every stack deploy, so
  changing a stack never moves a service to a different build.
- **A bad build rolls itself back.** A new API container must pass `/healthz` behind the load
  balancer before an old one stops; if it doesn't, AWS returns to the previous build and
  the deploy fails. There is only ever one worker: the old one stops before the new starts.
- **Three database logins.** The services sign in as `app_admin`, whose password is made up
  inside AWS (`postsocial/<env>/database-app`). Only the migration task holds the owner
  login. Neither password is ever in this repo, in GitHub or in a connection string.
- **Settings arrive as one JSON object** (`SETTINGS_JSON`, from `postsocial/<env>/api` or
  `/worker`). What is set on the container itself wins: the database's address, the
  environment's name and the API's own address can't be overridden by a copied setting.

## The checklist

Every build runs AWS's own security checklist (cdk-nag, the AWS Solutions rules). A finding
fails the build. Where we chose differently on purpose (no standby database, no paid
Container Insights, no load balancer access logs yet), the choice is written next to the
resource with its reason: search for `acknowledge(`.

## Working on it

```bash
cd infra/aws
npm ci
npm run typecheck
npm test          # what the templates must always say (private database, deploy roles, ...)
npm run synth     # builds the templates and runs the checklist; needs no AWS sign-in
```

CI runs the same four on every pull request.

## Deploying

Deploys change real AWS resources, and some cost money: they need the owner's OK first.

One time, to prepare the account: `npx cdk bootstrap aws://039612844713/us-east-1 --profile postsocial`.

Then, always reading the diff before deploying:

```bash
npx cdk diff   PostSocialFoundation --profile postsocial
npx cdk deploy PostSocialFoundation --profile postsocial
```

Order: `PostSocialFoundation`, then `PostSocialData-dev`, then `PostSocialEdge`, then
`PostSocialData-prod` shortly before the cutover. All four are live (2026-11-25).

### Bringing an environment's services up for the first time

The services stack starts containers, so it needs images to start and settings to read.

1. Deploy the shared and data stacks from this branch (adds the app login's password and
   lets the GitHub role record a build): `npx cdk deploy PostSocialFoundation PostSocialEdge PostSocialData-dev --profile postsocial`.
2. Fill in the settings: `node scripts/aws-copy-settings.mjs dev --dry-run`, read the list of
   names, then run it without `--dry-run`. Values go from InsForge to AWS without being shown.
3. Turn the deploy on (repository variable `AWS_DEV_DEPLOY` = `on`) and let it run once on
   `dev`. With no services yet it pushes the images and records the build, nothing else.
4. `npx cdk deploy PostSocialServices-dev --exclusively --profile postsocial`. The API starts
   but can't sign in to the database yet (`/healthz` 200, `/readyz` 503).
5. Run the deploy again (re-run the workflow). This time it runs the migration task, which
   sets up the database and gives `app_admin` its password, then rolls both services.
6. Add the DNS record in Cloudflare: `api-dev` CNAME to the load balancer's address, DNS only.

After that every push to `dev` that touches the backend deploys by itself
(`.github/workflows/deploy-aws-dev.yml`, `scripts/aws-deploy.mjs`).

### Filling an environment's database from InsForge

`node scripts/aws-copy-database.mjs dev`, from the main checkout, signed in to AWS as the
`postsocial` profile. It checks InsForge and the build on AWS have the same migrations, stops
the AWS services, runs the task `postsocial-dev-copy` inside the network
(`database/copy-from-insforge.sh`: everything in `public`, the people in `auth.users` and
their Google links), records the migrations as applied, and starts the API again. InsForge is
only read. The copy is one transaction: a run that fails leaves the AWS database as it was.

- **It refuses a database that already holds people** unless you add `--replace`, which
  swaps everything there for a fresh copy.
- **It refuses an environment whose worker runs on AWS.** That environment lives on AWS
  now, and a copy would put InsForge's old data over the real one. Dev is in that state
  since 2026-11-26, so dev is not copied again.
- **InsForge's database address** reaches the task through the secret
  `postsocial/<env>/insforge-address`, which the script creates for the run and deletes
  when it ends, with no recovery copy. It is never printed or written to a file.
- **The worker stays stopped afterwards.** Two workers on copies of the same data would both
  renew the same platform tokens and publish the same posts. An environment's AWS worker
  starts (`workerTasks` in `lib/config.ts`) only once its InsForge worker is stopped for good.
- **What is left behind:** InsForge's own tables (its sign-in settings, storage, logs), its
  default of giving every new table to everyone signed in, and the tokens Google returned at
  past sign-ins. `auth.user_providers` comes along only for `database/migrate-auth.sql`, which carries its
  rows over and removes it.
- **Prod** is copied once, at cutover; the script refuses it until then.

To try a change to the copy on your machine: `npm run db:local`, then run
`database/copy-from-insforge.sh` in a `postgres:15` container against it.

### Rotating the app login's password

Change the `password` in `postsocial/<env>/database-app` (Secrets Manager), then run a
deploy: the migration task gives the database the new password, and the services read it as
they restart. For the minute in between, new connections from the old containers fail.

- **The certificate waits for DNS.** The first `PostSocialEdge` deploy pauses until the
  records AWS asks for (shown in Certificate Manager) exist in Cloudflare.
- **Settings.** After a data stack exists, put the environment's settings into
  `postsocial/<env>/api` and `postsocial/<env>/worker` as one JSON object each, in the AWS
  console. A later deploy leaves them alone.
- **If a first deploy of a data stack fails,** CloudFormation rolls back but keeps the items
  marked to survive deletion (the settings secrets, and on prod the log groups and subnet
  group). Check they are empty, remove them and the failed stack, then deploy again, or the
  retry stops on "already exists". This happened on 2026-11-25.
- **Never rename** a construct that holds data (the database, a secret): CloudFormation would
  replace it. Read `cdk diff` for the word "replace" before every deploy.

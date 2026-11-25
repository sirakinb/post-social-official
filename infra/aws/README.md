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
| `PostSocialData-dev` | Dev's Postgres 15 database (private, encrypted), the firewall groups for its API and worker, its settings (`postsocial/dev/api`, `postsocial/dev/worker`) and logs | About $16 a month |
| `PostSocialData-prod` | The same for prod, with deletion protection and 7 days of automatic backups | About $16 a month |

Not here yet: the API and worker services themselves. They are added once the backend runs
as a Node service (step 6 in `tasks/aws-migration.md`), in their own stack per environment,
so a service change can never replace a database.

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
`PostSocialData-prod` shortly before the cutover.

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

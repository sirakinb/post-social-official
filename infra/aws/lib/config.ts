// Everything about where this runs, in one place. No secrets belong in this folder.
export const ACCOUNT = "039612844713";
export const REGION = "us-east-1";
// Named (not looked up) so building the templates needs no AWS sign-in.
export const AVAILABILITY_ZONES = ["us-east-1a", "us-east-1b"];

export const GITHUB_REPO = "sirakinb/post-social-official";
// How GitHub names this repository in the identity it signs each job with. The repository
// uses GitHub's immutable form, which carries the owner's and the repository's ids, so a
// renamed or re-created repository with the same name can't pass for it. Roles that trust
// the plain "repo:owner/name" form are refused (found on the first deploy, 2026-11-25).
// Read it with: gh api repos/sirakinb/post-social-official/actions/oidc/customization/sub
export const GITHUB_SUBJECT = "repo:sirakinb@13540758/post-social-official@1394110583";
// Created once by hand on 2026-11-24 (the nightly backup's role uses it too).
export const GITHUB_OIDC_PROVIDER_ARN = `arn:aws:iam::${ACCOUNT}:oidc-provider/token.actions.githubusercontent.com`;

export type EnvName = "dev" | "prod";

export type EnvConfig = {
  // Public address of this environment's API, on the shared load balancer.
  apiDomain: string;
  // The only branch, and the only GitHub environment, whose workflows may deploy here.
  deployBranch: string;
  githubEnvironment: string;
  // Days of automatic database backups.
  backupDays: number;
  // Prod only: the database can't be deleted by a deploy or by mistake.
  protect: boolean;
  // What the app and PostHog call this environment (APP_ENV).
  appEnv: "dev" | "production";
  // Copies of the API behind the load balancer.
  apiTasks: number;
  // The worker's share of a processor, in 1024ths (256 is a quarter). It has 1 GB of memory.
  workerCpu: 256 | 512;
  // 1, or 0 while this environment's worker still runs on InsForge. Never both at once on
  // the same data: two workers would renew the same platform tokens and publish the same
  // posts. Dev goes to 1 on the day the dev website moves to this backend.
  workerTasks: 0 | 1;
  // Where this environment's rule sits on the shared HTTPS listener. Must differ per environment.
  listenerPriority: number;
};

export const ENVIRONMENTS: Record<EnvName, EnvConfig> = {
  dev: { apiDomain: "api-dev.postsocial.xyz", deployBranch: "dev", githubEnvironment: "Development", backupDays: 1, protect: false, appEnv: "dev", apiTasks: 1, workerCpu: 256, workerTasks: 0, listenerPriority: 20 },
  prod: { apiDomain: "api.postsocial.xyz", deployBranch: "main", githubEnvironment: "Production", backupDays: 7, protect: true, appEnv: "production", apiTasks: 2, workerCpu: 512, workerTasks: 1, listenerPriority: 10 },
};

export const ENV_NAMES = Object.keys(ENVIRONMENTS) as EnvName[];

// The port the API and the worker listen on inside their containers.
export const CONTAINER_PORT = 8080;
export const DATABASE_NAME = "postsocial";

// Which build an environment runs: the commit its images are tagged with. The deploy
// workflow writes it after a build is pushed (and again once it is live); the services stack
// reads it, so changing the stack never moves a service to a different build. It is not
// created here on purpose: a stack that owned it would reset it.
export const imageTagParameter = (envName: EnvName) => `/postsocial/${envName}/image-tag`;

// Names other stacks and the deploy script refer to, so they are fixed here.
export const CLUSTER_NAME = "postsocial";
export const deployRoleName = (envName: EnvName) => `postsocial-github-deploy-${envName}`;

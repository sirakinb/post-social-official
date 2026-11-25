// Everything about where this runs, in one place. No secrets belong in this folder.
export const ACCOUNT = "039612844713";
export const REGION = "us-east-1";
// Named (not looked up) so building the templates needs no AWS sign-in.
export const AVAILABILITY_ZONES = ["us-east-1a", "us-east-1b"];

export const GITHUB_REPO = "sirakinb/post-social-official";
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
};

export const ENVIRONMENTS: Record<EnvName, EnvConfig> = {
  dev: { apiDomain: "api-dev.postsocial.xyz", deployBranch: "dev", githubEnvironment: "Development", backupDays: 1, protect: false },
  prod: { apiDomain: "api.postsocial.xyz", deployBranch: "main", githubEnvironment: "Production", backupDays: 7, protect: true },
};

export const ENV_NAMES = Object.keys(ENVIRONMENTS) as EnvName[];

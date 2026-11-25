// The whole setup: what is shared, then per environment a data stack and a services stack.
import { App, Tags, Validations } from "aws-cdk-lib";
import { AwsSolutionsChecks } from "cdk-nag";
import { ACCOUNT, ENVIRONMENTS, ENV_NAMES, REGION, type EnvName } from "./config";
import { DataStack } from "./data-stack";
import { EdgeStack } from "./edge-stack";
import { FoundationStack } from "./foundation-stack";
import { ServicesStack } from "./services-stack";

export function buildApp() {
  const app = new App();
  const env = { account: ACCOUNT, region: REGION };

  const foundation = new FoundationStack(app, "PostSocialFoundation", {
    env,
    description: "Post Social: network, image registry, container cluster and GitHub deploy roles (shared)",
    terminationProtection: true,
  });
  const edge = new EdgeStack(app, "PostSocialEdge", {
    env,
    vpc: foundation.vpc,
    description: "Post Social: the shared public load balancer and its certificate",
    terminationProtection: true,
  });
  const data = Object.fromEntries(
    ENV_NAMES.map((envName) => [
      envName,
      new DataStack(app, `PostSocialData-${envName}`, {
        env,
        envName,
        vpc: foundation.vpc,
        description: `Post Social ${envName}: database, settings and logs`,
        terminationProtection: ENVIRONMENTS[envName].protect,
      }),
    ]),
  ) as Record<EnvName, DataStack>;

  const services = Object.fromEntries(
    ENV_NAMES.map((envName) => [
      envName,
      new ServicesStack(app, `PostSocialServices-${envName}`, {
        env,
        envName,
        foundation,
        edge,
        data: data[envName],
        description: `Post Social ${envName}: the API, the worker and the migration task`,
        terminationProtection: ENVIRONMENTS[envName].protect,
      }),
    ]),
  ) as Record<EnvName, ServicesStack>;

  Tags.of(app).add("app", "postsocial");
  for (const envName of ENV_NAMES) {
    Tags.of(data[envName]).add("environment", envName);
    Tags.of(services[envName]).add("environment", envName);
  }
  // AWS's own checklist, run on every build. A finding fails the build unless it is
  // acknowledged next to the resource with a written reason (lib/acknowledge.ts).
  Validations.of(app).addPlugins(new AwsSolutionsChecks(app, { verbose: true }));

  return { app, foundation, edge, data, services };
}

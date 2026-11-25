// Rolls one environment on AWS to the images tagged with a commit.
//
//   node scripts/aws-deploy.mjs <dev|prod> <commit sha>
//
// Run by the deploy workflow after it has pushed postsocial/api:<sha> and
// postsocial/worker:<sha>. It signs in as nothing itself: it uses the AWS CLI with whatever
// role the workflow assumed, and that role can only do these steps for its own environment
// (infra/aws/lib/services-stack.ts).
//
//   1. If the services don't exist yet, record the build and stop (the first setup).
//   2. Run the migration task on the new image; stop if it fails. Nothing has changed yet.
//   3. Roll the API, then the worker, and wait. AWS goes back to the old build by itself if
//      the new one doesn't come up healthy; that counts as a failed deploy here.
//   4. Record the build as the one this environment runs.
//
// It prints names, ids and states only: never a setting's value, never container logs
// (this repository's workflow logs are public).
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const CLUSTER = "postsocial";
export const SERVICES = ["api", "worker"];

// What AWS adds to a task definition when it stores one, and refuses when you send it back.
const READ_ONLY = ["taskDefinitionArn", "revision", "status", "requiresAttributes", "compatibilities", "registeredAt", "registeredBy", "deregisteredAt"];

// The same task, pointed at a commit's image. Everything else stays as the stack set it.
export function nextTaskDefinition(current, tag) {
  if (!/^[0-9a-f]{40}$/.test(tag)) throw new Error("The build must be a full commit SHA.");
  const next = Object.fromEntries(Object.entries(current).filter(([key]) => !READ_ONLY.includes(key)));
  if (!Array.isArray(current.containerDefinitions) || current.containerDefinitions.length !== 1) throw new Error(`Expected one container in ${current.family}.`);
  const [container] = current.containerDefinitions;
  // Only ever our own registry: a task definition that points elsewhere is not ours to roll.
  const [, repository] = /^(\d{12}\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com\/postsocial\/(?:api|worker)):[^:/]+$/.exec(String(container.image)) ?? [];
  if (!repository) throw new Error(`${current.family} doesn't run a Post Social image.`);
  next.containerDefinitions = [{ ...container, image: `${repository}:${tag}` }];
  return next;
}

// Where a service's rollout stands, given the task definition we asked it to run.
export function rolloutState(service, taskDefinitionArn) {
  const primary = (service.deployments ?? []).find((deployment) => deployment.status === "PRIMARY");
  if (!primary) return { state: "running", detail: "no deployment yet" };
  // The circuit breaker put the old build back.
  if (primary.taskDefinition !== taskDefinitionArn) return { state: "failed", detail: "AWS went back to the previous build because the new one didn't come up healthy" };
  if (primary.rolloutState === "FAILED") return { state: "failed", detail: primary.rolloutStateReason ?? "the rollout failed" };
  const settled = primary.rolloutState === "COMPLETED" && (service.deployments ?? []).length === 1 && primary.runningCount === primary.desiredCount;
  return settled ? { state: "done", detail: `${primary.runningCount} running` } : { state: "running", detail: `${primary.runningCount ?? 0} of ${primary.desiredCount ?? "?"} running` };
}

// A one-off task's result: the container's own exit code, or why it never ran.
export function taskOutcome(task) {
  if (task.lastStatus !== "STOPPED") return { state: "running" };
  const [container] = task.containers ?? [];
  if (container && container.exitCode === 0) return { state: "done" };
  const reason = container?.exitCode != null ? `exit code ${container.exitCode}` : (task.stoppedReason ?? container?.reason ?? "it stopped without running");
  return { state: "failed", detail: reason };
}

// The subnets and firewall group a one-off task borrows from the API service.
export function networkOf(service) {
  const network = service.networkConfiguration?.awsvpcConfiguration;
  if (!network?.subnets?.length || !network?.securityGroups?.length) throw new Error("The API service has no network settings to run the migration task with.");
  return { awsvpcConfiguration: { subnets: network.subnets, securityGroups: network.securityGroups, assignPublicIp: network.assignPublicIp ?? "ENABLED" } };
}

function aws(args) {
  const out = execFileSync("aws", [...args, "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 16 * 1024 * 1024 });
  return out.trim() ? JSON.parse(out) : {};
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function register(family, tag) {
  const current = aws(["ecs", "describe-task-definition", "--task-definition", family]).taskDefinition;
  const registered = aws(["ecs", "register-task-definition", "--cli-input-json", JSON.stringify(nextTaskDefinition(current, tag))]).taskDefinition;
  console.log(`Registered ${registered.family}:${registered.revision}`);
  return registered.taskDefinitionArn;
}

async function migrate(envName, tag, apiService) {
  const taskDefinition = register(`postsocial-${envName}-migrate`, tag);
  const started = aws(["ecs", "run-task", "--cluster", CLUSTER, "--launch-type", "FARGATE", "--task-definition", taskDefinition, "--network-configuration", JSON.stringify(networkOf(apiService)), "--started-by", `deploy-${tag.slice(0, 12)}`]);
  const task = started.tasks?.[0]?.taskArn;
  if (!task) throw new Error(`The migration task didn't start: ${started.failures?.[0]?.reason ?? "no reason given"}`);
  console.log(`Migration task ${task.split("/").pop()} started`);
  for (let waited = 0; waited < 15 * 60; waited += 10) {
    await sleep(10_000);
    const outcome = taskOutcome(aws(["ecs", "describe-tasks", "--cluster", CLUSTER, "--tasks", task]).tasks?.[0] ?? {});
    if (outcome.state === "done") return console.log("Migrations applied");
    if (outcome.state === "failed") throw new Error(`The migration task failed (${outcome.detail}). Its output is in the log group /postsocial/${envName}/api, streams starting "migrate/". Nothing was rolled out.`);
  }
  throw new Error("The migration task was still running after 15 minutes. Nothing was rolled out.");
}

async function roll(envName, part, tag) {
  const service = `postsocial-${envName}-${part}`;
  const taskDefinition = register(service, tag);
  aws(["ecs", "update-service", "--cluster", CLUSTER, "--service", service, "--task-definition", taskDefinition, "--query", "service.serviceName"]);
  for (let waited = 0; waited < 20 * 60; waited += 15) {
    await sleep(15_000);
    const { state, detail } = rolloutState(aws(["ecs", "describe-services", "--cluster", CLUSTER, "--services", service]).services[0], taskDefinition);
    if (state === "done") return console.log(`${service} is on the new build (${detail})`);
    if (state === "failed") throw new Error(`${service} didn't roll out: ${detail}. Its output is in the log group /postsocial/${envName}/${part}.`);
    if (waited % 60 === 0) console.log(`${service}: ${detail}`);
  }
  throw new Error(`${service} was still rolling out after 20 minutes.`);
}

function record(envName, tag) {
  aws(["ssm", "put-parameter", "--name", `/postsocial/${envName}/image-tag`, "--type", "String", "--value", tag, "--overwrite", "--query", "Version"]);
  console.log(`Recorded ${tag} as the build ${envName} runs`);
}

async function main([envName, tag]) {
  if (envName !== "dev" && envName !== "prod") throw new Error("Usage: node scripts/aws-deploy.mjs <dev|prod> <commit sha>");
  if (!/^[0-9a-f]{40}$/.test(tag ?? "")) throw new Error("The build must be a full commit SHA.");

  const names = SERVICES.map((part) => `postsocial-${envName}-${part}`);
  const found = aws(["ecs", "describe-services", "--cluster", CLUSTER, "--services", ...names]);
  const active = (found.services ?? []).filter((service) => service.status === "ACTIVE");
  if (active.length === 0) {
    // First setup: the services stack reads this to know which images to start with.
    record(envName, tag);
    console.log(`The ${envName} services don't exist yet, so nothing was rolled out. Create them with: npx cdk deploy PostSocialServices-${envName}`);
    return "recorded";
  }
  if (active.length !== names.length) throw new Error(`Only ${active.map((service) => service.serviceName).join(", ")} exists; expected ${names.join(" and ")}.`);

  await migrate(envName, tag, active.find((service) => service.serviceName === names[0]));
  await roll(envName, "api", tag);
  await roll(envName, "worker", tag);
  record(envName, tag);
  return "deployed";
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).then(
    (result) => {
      // Lets the workflow know whether there is a live service to check afterwards.
      if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `result=${result}\n`);
    },
    (error) => {
      console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    },
  );
}

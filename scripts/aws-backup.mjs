// Starts one backup of an environment's database on AWS and waits for it to finish.
//
//   node scripts/aws-backup.mjs prod [--monthly]
//
// AWS itself starts the same task every night (infra/aws/lib/backup-stack.ts). This is for
// a run by hand: the "Back up prod database" workflow, or a person signed in to AWS. The
// task dumps the database from inside the network and uploads the file to our backup bucket;
// this script only starts it and reports how it ended.
//
// It prints names, ids and states only: never container logs (this repository's workflow
// logs are public).
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { CLUSTER, networkOf } from "./aws-deploy.mjs";

// Environments that have a backup task (infra/aws/lib/config.ts, BACKED_UP).
export const BACKED_UP = ["prod"];

// What to change for this run: nothing, or "also save the monthly copy".
export function overridesFor({ monthly }) {
  return monthly ? { containerOverrides: [{ name: "upload", environment: [{ name: "MONTHLY", value: "true" }] }] } : {};
}

// How a backup run ended. The task has two containers, and both must finish without error:
// if the dump fails, the upload never starts and has no exit code at all.
export function backupOutcome(task) {
  if (task.lastStatus !== "STOPPED") return { state: "running" };
  const containers = task.containers ?? [];
  const byName = Object.fromEntries(containers.map((container) => [container.name, container]));
  const failed = ["dump", "upload"].find((name) => byName[name]?.exitCode !== 0);
  if (!failed) return { state: "done" };
  const container = byName[failed];
  const why = container?.exitCode != null ? `exit code ${container.exitCode}` : (container?.reason ?? task.stoppedReason ?? "it never ran");
  return { state: "failed", detail: `the ${failed} step did not finish (${why})` };
}

function aws(args) {
  const out = execFileSync("aws", [...args, "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 16 * 1024 * 1024 });
  return out.trim() ? JSON.parse(out) : {};
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(args) {
  const [envName, ...flags] = args;
  if (!BACKED_UP.includes(envName) || flags.some((flag) => flag !== "--monthly")) throw new Error(`Usage: node scripts/aws-backup.mjs <${BACKED_UP.join("|")}> [--monthly]`);
  const monthly = flags.includes("--monthly");
  const family = `postsocial-${envName}-backup`;

  const apiName = `postsocial-${envName}-api`;
  const api = (aws(["ecs", "describe-services", "--cluster", CLUSTER, "--services", apiName]).services ?? []).find((service) => service.status === "ACTIVE");
  if (!api) throw new Error(`${apiName} doesn't exist, so there is no network to run the backup in.`);

  const started = aws(["ecs", "run-task", "--cluster", CLUSTER, "--launch-type", "FARGATE", "--task-definition", family, "--network-configuration", JSON.stringify(networkOf(api)), "--overrides", JSON.stringify(overridesFor({ monthly })), "--started-by", "backup-by-hand"]);
  const task = started.tasks?.[0]?.taskArn;
  if (!task) throw new Error(`The backup task didn't start: ${started.failures?.[0]?.reason ?? "no reason given"}`);
  console.log(`Backup task ${task.split("/").pop()} started${monthly ? " (also saving the monthly copy)" : ""}`);

  for (let waited = 0; waited < 30 * 60; waited += 10) {
    await sleep(10_000);
    const outcome = backupOutcome(aws(["ecs", "describe-tasks", "--cluster", CLUSTER, "--tasks", task]).tasks?.[0] ?? {});
    if (outcome.state === "done") return console.log(`Backed up ${envName}: the dump is in the backup bucket's daily folder${monthly ? " and its monthly folder" : ""}.`);
    if (outcome.state === "failed") throw new Error(`The backup failed: ${outcome.detail}. Its output is in the log group /postsocial/${envName}/api, streams starting "backup-dump" and "backup-upload".`);
  }
  throw new Error("The backup task was still running after 30 minutes.");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}

// Fills an environment's AWS database with a copy of its InsForge database.
//
//   node scripts/aws-copy-database.mjs dev [--replace]
//
// The AWS database has no public address, so the copy runs inside the network as the
// one-off task postsocial-<env>-copy (database/copy-from-insforge.sh). This script is what
// starts it, from a laptop:
//
//   1. checks InsForge and the build on AWS have the same migrations
//   2. stops the AWS services, so nothing reads a half-filled database
//   3. hands the task InsForge's database address through a secret made for this run
//      (never printed, never written to a file, never on a command line), runs it, and
//      deletes the secret, with no recovery copy
//   4. runs the migration task with --baseline, which records the migrations as applied
//   5. starts the API again and checks it answers
//
// The worker is left stopped on purpose. Two workers on copies of the same data would both
// renew the same platform tokens and publish the same posts, so the AWS worker starts only
// once the InsForge one is stopped for good.
//
// --replace is needed when the AWS database already holds people (a second copy).
// Only InsForge is read; the copy itself is one transaction, so a failed run leaves the AWS
// database as it was.
//
// Run it from the main checkout (the folder linked to InsForge), signed in to AWS as the
// `postsocial` profile. Prod is copied once, at cutover, and is switched on here then.
// It refuses an environment whose worker already runs on AWS (dev since 2026-11-26): that
// environment's data now lives on AWS, and a copy would overwrite it.
import { execFileSync, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { CLUSTER, networkOf, taskOutcome } from "./aws-deploy.mjs";

const ACCOUNT = "039612844713";
const ENVIRONMENTS = { dev: { api: "https://api-dev.postsocial.xyz" } };
const AWS = ["--profile", process.env.AWS_PROFILE ?? "postsocial", "--region", "us-east-1"];
// Must match copySourceSecret in infra/aws/lib/config.ts: the copy task reads this name.
export const sourceSecret = (envName) => `postsocial/${envName}/insforge-address`;

// The database address in whatever the InsForge CLI printed around it.
export function addressIn(text) {
  return /postgres(?:ql)?:\/\/[^\s"']+/.exec(text)?.[0] ?? null;
}

// Migrations one side has and the other doesn't. Both must be empty before a copy: the
// baseline records every migration in the AWS build as applied, which is only true when
// InsForge has applied exactly those.
export function migrationGap(insforgeVersions, buildFiles) {
  const theirs = new Set(insforgeVersions.map((version) => String(version).padStart(14, "0")));
  const ours = new Set(buildFiles.map((file) => /^(\d{14})_/.exec(file.split("/").pop())?.[1]).filter(Boolean));
  return { onlyInsforge: [...theirs].filter((version) => !ours.has(version)).sort(), onlyBuild: [...ours].filter((version) => !theirs.has(version)).sort() };
}

// An environment whose worker runs on AWS lives there: its AWS database is the real one,
// and a copy would put InsForge's old data over it. (Dev since 2026-11-26.)
export function livesOnAws(workerService) {
  return (workerService?.desiredCount ?? 0) > 0;
}

// A parse error can quote the text it choked on: say only what couldn't be read.
function parse(text, what) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Couldn't read ${what}.`);
  }
}

function aws(args, input) {
  const result = spawnSync("aws", [...args, "--output", "json", ...AWS], { input, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  // AWS's own message names the call and the resource, never a value we sent on stdin.
  if (result.status !== 0) throw new Error(`AWS refused: ${args.slice(0, 2).join(" ")}. ${(result.stderr ?? "").trim().split("\n").pop() ?? ""}`);
  return result.stdout.trim() ? parse(result.stdout, `AWS's answer to ${args.slice(0, 2).join(" ")}`) : {};
}

// Gone at once, with no 30-day recovery copy. Fine when it isn't there.
function deleteSecret(id) {
  try {
    aws(["secretsmanager", "delete-secret", "--secret-id", id, "--force-delete-without-recovery", "--query", "Name"]);
  } catch (error) {
    if (!/ResourceNotFoundException/.test(error.message)) throw error;
  }
}

// The address goes in through standard input. A name is free again a few seconds after
// its secret is deleted, so a run straight after another waits for that.
async function createSecret(id, value) {
  deleteSecret(id);
  for (let tries = 0; ; tries++) {
    try {
      return aws(["secretsmanager", "create-secret", "--name", id, "--description", "InsForge's database address, for the minutes a copy runs (scripts/aws-copy-database.mjs)", "--secret-string", "file:///dev/stdin", "--query", "Name"], value);
    } catch (error) {
      if (tries >= 12 || !/scheduled for deletion|InvalidRequestException|ResourceExistsException/.test(error.message)) throw error;
      await sleep(5_000);
    }
  }
}

function insforge(envName, args) {
  const result = spawnSync("scripts/insforge-env.sh", [envName, ...args], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`InsForge didn't answer for: ${args.slice(0, 2).join(" ")}`);
  return result.stdout;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function services(envName) {
  const names = ["api", "worker"].map((part) => `postsocial-${envName}-${part}`);
  const found = aws(["ecs", "describe-services", "--cluster", CLUSTER, "--services", ...names]).services ?? [];
  const byName = Object.fromEntries(found.filter((service) => service.status === "ACTIVE").map((service) => [service.serviceName, service]));
  if (names.some((name) => !byName[name])) throw new Error(`The ${envName} services don't exist on AWS yet.`);
  return { api: byName[names[0]], worker: byName[names[1]] };
}

async function scale(envName, part, count) {
  const service = `postsocial-${envName}-${part}`;
  aws(["ecs", "update-service", "--cluster", CLUSTER, "--service", service, "--desired-count", String(count), "--query", "service.serviceName"]);
  for (let waited = 0; waited < 10 * 60; waited += 10) {
    const now = services(envName)[part];
    if (now.runningCount === count && now.deployments.length === 1) return console.log(`${service}: ${count} running`);
    await sleep(10_000);
  }
  throw new Error(`${service} didn't reach ${count} running in 10 minutes.`);
}

// Runs a one-off task to the end and prints what it logged (names and counts only).
async function run(envName, part, network, overrides) {
  const family = `postsocial-${envName}-${part}`;
  const started = aws(["ecs", "run-task", "--cluster", CLUSTER, "--launch-type", "FARGATE", "--task-definition", family, "--network-configuration", JSON.stringify(network), "--started-by", "copy-database", "--overrides", JSON.stringify({ containerOverrides: [{ name: part, ...overrides }] })]);
  const task = started.tasks?.[0]?.taskArn;
  if (!task) throw new Error(`The ${part} task didn't start: ${started.failures?.[0]?.reason ?? "no reason given"}`);
  const id = task.split("/").pop();
  console.log(`${family} started (${id})`);
  let outcome = { state: "running" };
  for (let waited = 0; waited < 20 * 60 && outcome.state === "running"; waited += 10) {
    await sleep(10_000);
    outcome = taskOutcome(aws(["ecs", "describe-tasks", "--cluster", CLUSTER, "--tasks", task]).tasks?.[0] ?? {});
  }
  // Both tasks log to the API's group, under their own name. The last lines can take a
  // few seconds to arrive after the task stops.
  const stream = `${part}/${part}/${id}`;
  let events = [];
  for (let tries = 0; tries < 6 && !events.length; tries++) {
    if (tries) await sleep(5_000);
    try {
      events = aws(["logs", "get-log-events", "--log-group-name", `/postsocial/${envName}/api`, "--log-stream-name", stream, "--start-from-head"]).events ?? [];
    } catch {
      // Not there yet.
    }
  }
  for (const event of events) console.log(`  | ${event.message}`);
  if (!events.length) console.log(`  (its output is in the log group /postsocial/${envName}/api, stream ${stream})`);
  if (outcome.state !== "done") throw new Error(`The ${part} task ${outcome.state === "failed" ? `failed (${outcome.detail})` : "was still running after 20 minutes"}.`);
}

async function main(args) {
  const envName = args.find((arg) => !arg.startsWith("--"));
  const replace = args.includes("--replace");
  if (!envName || args.some((arg) => arg !== envName && arg !== "--replace")) throw new Error("Usage: node scripts/aws-copy-database.mjs dev [--replace]");
  if (!ENVIRONMENTS[envName]) throw new Error(`Only dev can be copied for now. ${envName === "prod" ? "Prod is copied once, at cutover." : ""}`.trim());

  const account = aws(["sts", "get-caller-identity"]).Account;
  if (account !== ACCOUNT) throw new Error("Signed in to a different AWS account.");

  // 1. The same migrations on both sides.
  const build = aws(["ssm", "get-parameter", "--name", `/postsocial/${envName}/image-tag`]).Parameter.Value;
  const files = execFileSync("git", ["ls-tree", "--name-only", build, "migrations/"], { encoding: "utf8" }).split("\n").filter(Boolean);
  const applied = parse(insforge(envName, ["db", "migrations", "list", "--json"]), "InsForge's list of migrations").migrations.map((migration) => migration.version);
  const gap = migrationGap(applied, files);
  if (gap.onlyInsforge.length || gap.onlyBuild.length) {
    throw new Error(`InsForge ${envName} and the build on AWS (${build.slice(0, 12)}) don't have the same migrations. Only on InsForge: ${gap.onlyInsforge.join(", ") || "none"}. Only in the build: ${gap.onlyBuild.join(", ") || "none"}. Bring them level, then run this again. Nothing was changed.`);
  }
  console.log(`Migrations match: ${applied.length} on InsForge ${envName} and in build ${build.slice(0, 12)}`);

  const before = services(envName);
  if (livesOnAws(before.worker)) {
    throw new Error(`The ${envName} worker runs on AWS, so the AWS database is the real one and a copy would overwrite it with InsForge's old data. Nothing was changed.`);
  }
  const network = networkOf(before.api);
  const apiCount = before.api.desiredCount;
  const source = sourceSecret(envName);
  aws(["ecs", "describe-task-definition", "--task-definition", `postsocial-${envName}-copy`, "--query", "taskDefinition.family"]);

  const address = addressIn(insforge(envName, ["db", "connection-string"]));
  if (!address) throw new Error("InsForge didn't return a database address. Nothing was changed.");

  try {
    // 2. Nothing of ours reads or writes while the copy goes in.
    await scale(envName, "worker", 0);
    await scale(envName, "api", 0);
    // 3. The address exists on AWS from here until `finally`.
    await createSecret(source, address);
    await run(envName, "copy", network, replace ? { environment: [{ name: "REPLACE", value: "yes" }] } : {});
    // 4. The migrations came with the copy; record them, and set the API's login up again.
    await run(envName, "migrate", network, { command: ["node", "migrate.mjs", "--bootstrap", "--baseline"] });
  } finally {
    try {
      deleteSecret(source);
      console.log(`${source} is deleted`);
    } catch {
      console.error(`Couldn't delete the secret ${source}. Delete it by hand, without a recovery window.`);
    }
    // 5. Whatever happened, the API comes back: a failed copy changed nothing.
    await scale(envName, "api", apiCount).catch((error) => console.error(error.message));
  }

  // The load balancer takes a moment to send requests to the new container.
  let ready = 0;
  for (let tries = 0; tries < 12 && ready !== 200; tries++) {
    if (tries) await sleep(10_000);
    ready = await fetch(`${ENVIRONMENTS[envName].api}/readyz`).then((response) => response.status, () => 0);
  }
  if (ready !== 200) throw new Error(`The copy is in, but ${ENVIRONMENTS[envName].api}/readyz answered ${ready || "nothing"}.`);
  console.log(`${ENVIRONMENTS[envName].api} answers and reaches its database`);
  console.log(`Done. The ${envName} worker on AWS is stopped. Start it only once the InsForge ${envName} worker is stopped for good.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error) => {
    // The message only: never a stack or output that could carry the address.
    console.error(error instanceof Error ? error.message : "The copy failed.");
    process.exit(1);
  });
}

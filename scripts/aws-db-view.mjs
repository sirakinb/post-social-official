// Opens a private, read-only way to look at an environment's database from this machine.
//
//   npm run db:view -- <dev|prod> [--psql]
//
// The databases have no public address. This starts a small task inside our network
// (postsocial-<env>-tunnel), has AWS's session service carry one local port through it to
// the database, and tells you where to point a database app (TablePlus, Postico, DBeaver,
// psql): 127.0.0.1, the port it prints, the login app_viewer. That login can only read
// (database/viewer.sql). Its password is read from AWS and put on the clipboard, never
// printed; the clipboard is cleared when you close this. With --psql it opens psql for you
// instead.
//
// Ctrl+C closes the way in and stops the task. Left alone, the task stops by itself after a
// few hours. Needs your own AWS sign-in (the `postsocial` profile) and AWS's Session Manager
// plugin (https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html).
import { execFileSync, spawn, spawnSync } from "node:child_process";
import net from "node:net";
import { pathToFileURL } from "node:url";
import { CLUSTER, networkOf } from "./aws-deploy.mjs";

export const VIEWER_LOGIN = "app_viewer";
export const DATABASE_NAME = "postsocial";
// A fixed local port per environment, so a saved connection in a database app keeps working.
export const LOCAL_PORTS = { dev: 54321, prod: 54320 };

// Whether the task can carry a session yet: it must be running, and so must the session
// agent AWS puts inside it (which starts a few seconds after the container).
export function tunnelState(task) {
  if (task.lastStatus === "STOPPED" || task.stopCode) return { state: "failed", detail: task.stoppedReason ?? "the task stopped" };
  const [container] = task.containers ?? [];
  const agent = (container?.managedAgents ?? []).find((managed) => managed.name === "ExecuteCommandAgent");
  if (task.lastStatus !== "RUNNING" || agent?.lastStatus !== "RUNNING" || !container?.runtimeId) return { state: "starting" };
  return { state: "ready", runtimeId: container.runtimeId };
}

// How the session service names a container inside a task.
export function sessionTarget(taskArn, runtimeId) {
  const taskId = String(taskArn).split("/").pop();
  if (!/^[0-9a-f]{32}$/.test(taskId) || !/^[0-9a-f]{32}-\d+$/.test(runtimeId)) throw new Error("That is not a task and container the session service can reach.");
  return `ecs:${CLUSTER}_${taskId}_${runtimeId}`;
}

// What the session carries: one local port to the database's own address and port.
export function sessionParameters(database, localPort) {
  if (!/^[a-z0-9.-]+\.rds\.amazonaws\.com$/.test(database.host)) throw new Error("That is not one of our database addresses.");
  return { host: [database.host], portNumber: [String(database.port)], localPortNumber: [String(localPort)] };
}

// What to type into a database app. Never the password.
export function connectionDetails(envName, localPort) {
  return [`Host      127.0.0.1`, `Port      ${localPort}`, `User      ${VIEWER_LOGIN}`, `Database  ${DATABASE_NAME}`, `SSL       required (don't verify the certificate: the address is this machine's)`, `Name it   Post Social ${envName} (read-only)`].join("\n");
}

function aws(args) {
  const out = execFileSync("aws", [...args, "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 16 * 1024 * 1024 });
  return out.trim() ? JSON.parse(out) : {};
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const onPath = (command) => spawnSync("which", [command], { stdio: "ignore" }).status === 0;
const portIsFree = (port) =>
  new Promise((resolve) => {
    const probe = net.createServer().once("error", () => resolve(false)).once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, "127.0.0.1");
  });
const portAnswers = (port) =>
  new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" }).once("connect", () => (socket.destroy(), resolve(true))).once("error", () => resolve(false));
  });

async function main(args) {
  const [envName, ...flags] = args;
  if (!(envName in LOCAL_PORTS) || flags.some((flag) => flag !== "--psql")) throw new Error("Usage: npm run db:view -- <dev|prod> [--psql]");
  const usePsql = flags.includes("--psql");
  if (!onPath("session-manager-plugin")) throw new Error("AWS's Session Manager plugin isn't installed. Install it once (see the link at the top of scripts/aws-db-view.mjs), then run this again.");
  if (usePsql && !onPath("psql")) throw new Error("psql isn't installed. Run without --psql and use a database app.");
  const localPort = LOCAL_PORTS[envName];
  if (!(await portIsFree(localPort))) throw new Error(`Port ${localPort} on this machine is in use. Is another "db:view ${envName}" still open?`);

  const apiName = `postsocial-${envName}-api`;
  const api = (aws(["ecs", "describe-services", "--cluster", CLUSTER, "--services", apiName]).services ?? []).find((service) => service.status === "ACTIVE");
  if (!api) throw new Error(`${apiName} doesn't exist, so there is no network to reach the database through.`);
  const endpoint = aws(["rds", "describe-db-instances", "--db-instance-identifier", `postsocial-${envName}`]).DBInstances?.[0]?.Endpoint;
  if (!endpoint) throw new Error(`The ${envName} database wasn't found.`);
  const parameters = sessionParameters({ host: endpoint.Address, port: endpoint.Port }, localPort);

  console.log(`Starting a way in to the ${envName} database (about half a minute)...`);
  const started = aws(["ecs", "run-task", "--cluster", CLUSTER, "--launch-type", "FARGATE", "--task-definition", `postsocial-${envName}-tunnel`, "--network-configuration", JSON.stringify(networkOf(api)), "--enable-execute-command", "--started-by", "db-view"]);
  const taskArn = started.tasks?.[0]?.taskArn;
  if (!taskArn) throw new Error(`The task didn't start: ${started.failures?.[0]?.reason ?? "no reason given"}`);

  let session = null;
  let clipboardHoldsPassword = false;
  let closing = false;
  const close = (code) => {
    if (closing) return;
    closing = true;
    session?.kill("SIGTERM");
    // Only clear the clipboard if it still holds what we put there.
    if (clipboardHoldsPassword) spawnSync("pbcopy", [], { input: "" });
    try {
      aws(["ecs", "stop-task", "--cluster", CLUSTER, "--task", taskArn, "--reason", "db-view closed"]);
      console.log("\nClosed. The task is stopped.");
    } catch {
      console.error(`\nCouldn't stop the task. It stops by itself within a few hours; to stop it now: aws ecs stop-task --cluster ${CLUSTER} --task ${taskArn.split("/").pop()}`);
    }
    process.exit(code);
  };
  process.on("SIGINT", () => close(0));
  process.on("SIGTERM", () => close(0));

  try {
    let target = null;
    for (let waited = 0; waited < 180 && !target; waited += 3) {
      await sleep(3000);
      const state = tunnelState(aws(["ecs", "describe-tasks", "--cluster", CLUSTER, "--tasks", taskArn]).tasks?.[0] ?? {});
      if (state.state === "failed") throw new Error(`The task stopped before it was ready (${state.detail}).`);
      if (state.state === "ready") target = sessionTarget(taskArn, state.runtimeId);
    }
    if (!target) throw new Error("The task wasn't ready after 3 minutes.");

    session = spawn("aws", ["ssm", "start-session", "--target", target, "--document-name", "AWS-StartPortForwardingSessionToRemoteHost", "--parameters", JSON.stringify(parameters)], { stdio: ["ignore", "ignore", "inherit"] });
    session.once("exit", () => {
      if (!closing) {
        console.error("\nThe session ended.");
        close(1);
      }
    });
    let open = false;
    for (let waited = 0; waited < 30 && !open; waited += 1) {
      await sleep(1000);
      open = await portAnswers(localPort);
    }
    if (!open) throw new Error("The local port never opened.");

    // Read at the last moment, kept in memory only.
    const { password } = JSON.parse(aws(["secretsmanager", "get-secret-value", "--secret-id", `postsocial/${envName}/database-viewer`]).SecretString);
    if (usePsql) {
      console.log(`Connected to ${envName} as ${VIEWER_LOGIN} (read-only). Type \\q to leave.\n`);
      const psql = spawn("psql", ["--host", "127.0.0.1", "--port", String(localPort), "--username", VIEWER_LOGIN, "--dbname", DATABASE_NAME], { stdio: "inherit", env: { ...process.env, PGPASSWORD: password, PGSSLMODE: "require" } });
      // Ctrl+C belongs to psql while it runs (it cancels a query); leaving psql closes everything.
      process.removeAllListeners("SIGINT");
      process.on("SIGINT", () => {});
      psql.once("exit", () => close(0));
      return;
    }
    if (onPath("pbcopy")) {
      spawnSync("pbcopy", [], { input: password });
      clipboardHoldsPassword = true;
    }
    console.log(`\nThe ${envName} database is reachable from this machine, read-only:\n\n${connectionDetails(envName, localPort)}\n`);
    console.log(clipboardHoldsPassword ? "The password is on your clipboard: paste it into the app's password box (save it there and you won't need it again). It is cleared from the clipboard when you close this." : `The password is the "password" value of the secret postsocial/${envName}/database-viewer in AWS Secrets Manager.`);
    console.log("\nLeave this window open while you look. Press Ctrl+C to close the way in.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    close(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

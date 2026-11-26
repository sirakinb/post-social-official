// Copies an environment's settings from InsForge's secrets into the two AWS Secrets Manager
// secrets the services read (postsocial/<env>/api and postsocial/<env>/worker), each one
// JSON object.
//
//   node scripts/aws-copy-settings.mjs <dev|prod> [--dry-run]
//
// Values go from InsForge to AWS inside this process: they are never printed, never written
// to a file and never put on a command line. It prints setting names and counts only.
// --dry-run reads the names from InsForge and shows what would be written, touching nothing.
//
// Run it from the main checkout (the folder linked to InsForge), signed in to AWS as the
// `postsocial` profile. Existing keys in the AWS secret that InsForge doesn't have are kept;
// keys InsForge has are replaced with InsForge's value. Secrets Manager keeps the previous
// version (AWSPREVIOUS) if a run needs undoing.
import { execFileSync, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// InsForge's own keys (its `isReserved` flag covers them; listed for the reader): they open
// InsForge itself, and nothing on AWS should hold them.
const INSFORGE_ONLY = ["ANON_KEY", "API_KEY", "JWT_KEY_ID", "JWT_PRIVATE_KEY", "JWT_PUBLIC_KEY", "JWT_SECRET", "VERCEL_WEBHOOK_SECRET"];
// Decided by the AWS setup itself (infra/aws/lib/services-stack.ts), so not copied.
const SET_BY_AWS = ["APP_ENV", "CONNECTIONS_BASE_URL", "API_BASE_URL"];
// Until sign-in moves to Better Auth, the API checks sign-in tokens with InsForge. It needs
// the address for that and no key.
const API_ALSO = ["INSFORGE_BASE_URL"];

// What the worker reads (the same list scripts/deploy-worker.sh passes on InsForge).
export const WORKER_REQUIRED = ["R2_ACCOUNT_ID", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "CREDENTIAL_ENCRYPTION_KEY"];
export const WORKER_OPTIONAL = [
  "TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET",
  "BLUESKY_CLIENT_JWK", "X_CLIENT_ID", "X_CLIENT_SECRET", "CONNECTIONS_PUBLIC_URL", "PUBLISH_ALLOWLIST", "ANALYTICS_PLATFORMS",
  "ANALYTICS_PUBLIC_PLATFORMS", "ANALYTICS_PREVIEW_PLATFORMS", "ANALYTICS_PREVIEW_WORKSPACES", "INBOX_WORKSPACES", "LINK_BASE_URL",
  "SCRAPECREATORS_API_KEY", "ALERT_EMAIL", "RESEND_API_KEY", "ALERT_CREDITS_BELOW", "NUDGE_EMAILS", "EMAIL_LINK_SECRET", "WEB_APP_HOME",
  "EMAIL_APP_URL", "POSTHOG_KEY", "POSTHOG_HOST",
];
const API_REQUIRED = ["R2_ACCOUNT_ID", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "CREDENTIAL_ENCRYPTION_KEY", "WEB_APP_HOME"];

// Which of InsForge's secret names go to which AWS secret, and what is missing.
// `secrets` is InsForge's list: [{ key, isReserved, isActive }].
export function plan(envName, secrets) {
  const usable = secrets.filter((secret) => secret.isActive !== false);
  const names = new Set(usable.map((secret) => secret.key));
  const ours = usable.filter((secret) => !secret.isReserved && !INSFORGE_ONLY.includes(secret.key) && !SET_BY_AWS.includes(secret.key)).map((secret) => secret.key);
  const api = [...new Set([...ours, ...API_ALSO.filter((name) => names.has(name))])].sort();
  const worker = [...WORKER_REQUIRED, ...WORKER_OPTIONAL].filter((name) => ours.includes(name)).sort();
  // Dev may only publish to the owner's approved test accounts, so its worker must have the list.
  const workerRequired = envName === "dev" ? [...WORKER_REQUIRED, "PUBLISH_ALLOWLIST"] : WORKER_REQUIRED;
  const missing = [...API_REQUIRED.filter((name) => !api.includes(name)).map((name) => `api: ${name}`), ...workerRequired.filter((name) => !worker.includes(name)).map((name) => `worker: ${name}`)];
  return { api, worker, missing };
}

// The new JSON for an AWS secret: what is there, with InsForge's values on top.
export function merge(existing, incoming) {
  const kept = Object.keys(existing).filter((name) => !(name in incoming));
  const changed = Object.keys(incoming).filter((name) => name in existing && existing[name] !== incoming[name]);
  const added = Object.keys(incoming).filter((name) => !(name in existing));
  return { value: { ...existing, ...incoming }, kept, changed, added };
}

const insforge = (envName, args) => {
  // The wrapper asks for "prod" to be typed before anything on prod; these are reads only.
  const result = spawnSync("scripts/insforge-env.sh", [envName, ...args], { input: "prod\n", encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`InsForge didn't answer for: ${args.slice(0, 2).join(" ")}`);
  const text = result.stdout;
  const start = Math.min(...["[", "{"].map((mark) => text.indexOf(mark)).filter((index) => index >= 0));
  return parse(text.slice(start), `InsForge's answer for: ${args.slice(0, 2).join(" ")}`);
};

// A parse error can quote the text it choked on, which here may be a secret: say only what
// couldn't be read.
function parse(text, what) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Couldn't read ${what}.`);
  }
}

const AWS = ["--profile", process.env.AWS_PROFILE ?? "postsocial", "--region", "us-east-1"];

function readAwsSecret(id) {
  const text = execFileSync("aws", ["secretsmanager", "get-secret-value", "--secret-id", id, "--query", "SecretString", "--output", "text", ...AWS], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  const value = parse(text, id);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${id} doesn't hold a JSON object.`);
  return value;
}

function writeAwsSecret(id, value) {
  // The value goes in through standard input, so it is never on a command line.
  const result = spawnSync("aws", ["secretsmanager", "put-secret-value", "--secret-id", id, "--secret-string", "file:///dev/stdin", "--query", "VersionId", "--output", "text", ...AWS], { input: JSON.stringify(value), encoding: "utf8" });
  if (result.status !== 0) throw new Error(`AWS refused the new value for ${id}.`);
}

async function main(args) {
  const envName = args.find((arg) => arg === "dev" || arg === "prod");
  const dryRun = args.includes("--dry-run");
  if (!envName || args.some((arg) => arg !== envName && arg !== "--dry-run")) throw new Error("Usage: node scripts/aws-copy-settings.mjs <dev|prod> [--dry-run]");

  const listed = insforge(envName, ["secrets", "list", "--json"]);
  const secrets = Array.isArray(listed) ? listed : (listed.secrets ?? listed.data ?? []);
  const { api, worker, missing } = plan(envName, secrets);
  if (missing.length) throw new Error(`InsForge ${envName} is missing settings the services need: ${missing.join(", ")}. Nothing was written.`);

  console.log(`postsocial/${envName}/api    <- ${api.length} settings: ${api.join(", ")}`);
  console.log(`postsocial/${envName}/worker <- ${worker.length} settings: ${worker.join(", ")}`);
  if (dryRun) return console.log("Dry run: nothing was read beyond the names, nothing was written.");

  // Read every value first, so a failed read stops the run before anything changes on AWS.
  const values = {};
  for (const name of new Set([...api, ...worker])) {
    const value = insforge(envName, ["secrets", "get", name, "--json"]).value;
    if (typeof value !== "string" || value === "") throw new Error(`Couldn't read ${name} from InsForge ${envName}. Nothing was written; try again.`);
    values[name] = value;
  }
  for (const [service, names] of [["api", api], ["worker", worker]]) {
    const id = `postsocial/${envName}/${service}`;
    const { value, kept, changed, added } = merge(readAwsSecret(id), Object.fromEntries(names.map((name) => [name, values[name]])));
    writeAwsSecret(id, value);
    console.log(`${id}: ${added.length} added, ${changed.length} changed, ${kept.length} kept as they were${kept.length ? ` (${kept.join(", ")})` : ""}`);
  }
  console.log("Done. Services pick the new settings up when they next start (a deploy, or a restart).");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error) => {
    // The message only: never a stack or output that could carry a value.
    console.error(error instanceof Error ? error.message : "The copy failed.");
    process.exit(1);
  });
}

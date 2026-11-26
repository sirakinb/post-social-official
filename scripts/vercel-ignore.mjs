// Vercel "Ignored Build Step" (vercel.json ignoreCommand). Exit 0 skips the build, exit 1 builds.
//
// Production never builds here: the release workflow deploys it. Previews build only when
// someone will look at them:
// - dev: builds after each merge, unless the change can't affect the website (worker,
//   migrations, functions, tests, docs...). So the dev link always shows the latest work.
//   A commit message with [preview] builds it anyway: the way to pick up a changed setting
//   in Vercel, which only reaches the site at its next build.
// - feature branches: build only when the latest commit message contains [preview].
// - staging and main: never (also turned off in vercel.json).
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const PREVIEW_TAG = /\[preview\]/i;

// Paths the website build never reads. Anything else (src, public, backend/lib, config,
// package files) counts as a website change.
const NOT_WEBSITE = [
  /^migrations\//,
  /^docs\//,
  /^tasks\//,
  /^e2e\//,
  /^\.e2e\//,
  /^adzo-tests\//,
  /^submission\//,
  /^ops\//,
  /^infra\//,
  /^cli\//,
  /^\.github\//,
  /^backend\/functions\//,
  /^backend\/tests\//,
  // The Node API service for AWS: its entry points, image and database setup.
  /^backend\/(server|service|migrate)\.ts$/,
  /^backend\/(Dockerfile|build\.sh|\.dockerignore)$/,
  /^database\//,
  /^worker\//,
  /^scripts\/(?!vercel-ignore)/,
  /\.test\.tsx?$/,
  /\.md$/,
  /^insforge\.toml$/,
  /^e2e\.config\.ts$/,
];

// Worker files that backend/lib imports, so the website build does read them.
const WORKER_FILES_THE_WEBSITE_USES = [/^worker\/src\/credentials\./, /^worker\/src\/publish\/types\./];

export function affectsWebsite(file) {
  if (WORKER_FILES_THE_WEBSITE_USES.some((re) => re.test(file))) return true;
  return !NOT_WEBSITE.some((re) => re.test(file));
}

/**
 * @param {{ ref: string, message: string, changedFiles: string[] | null, target?: string }} input
 *   changedFiles is null when the files since the last build can't be worked out.
 *   target is VERCEL_ENV: "production" for the release workflow's deploy, which always builds.
 * @returns {{ build: boolean, reason: string }}
 */
export function decide({ ref, message, changedFiles, target = "" }) {
  if (target === "production") return { build: true, reason: "production deploys always build" };
  if (ref === "main" || ref === "staging") return { build: false, reason: `${ref} previews are off; the release workflow deploys production` };
  if (ref !== "dev") {
    return PREVIEW_TAG.test(message)
      ? { build: true, reason: "the commit asks for a preview" }
      : { build: false, reason: "feature branches build only when a commit message contains [preview]" };
  }
  if (PREVIEW_TAG.test(message)) return { build: true, reason: "the commit asks for a build" };
  if (changedFiles === null) return { build: true, reason: "couldn't tell what changed, so building to be safe" };
  const website = changedFiles.filter(affectsWebsite);
  return website.length > 0
    ? { build: true, reason: `website files changed (${website.slice(0, 3).join(", ")}${website.length > 3 ? ", ..." : ""})` }
    : { build: false, reason: "nothing the website uses changed" };
}

function changedSince(previousSha) {
  if (!previousSha) return null;
  try {
    const out = execFileSync("git", ["diff", "--name-only", previousSha, "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out.split("\n").filter(Boolean);
  } catch {
    return null; // shallow clone without that commit
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { build, reason } = decide({
    ref: process.env.VERCEL_GIT_COMMIT_REF ?? "",
    message: process.env.VERCEL_GIT_COMMIT_MESSAGE ?? "",
    changedFiles: changedSince(process.env.VERCEL_GIT_PREVIOUS_SHA),
    target: process.env.VERCEL_ENV ?? "",
  });
  console.log(`${build ? "Building" : "Skipping"} this deploy: ${reason}.`);
  process.exit(build ? 1 : 0);
}

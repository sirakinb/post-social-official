// Invite a closed-beta tester: create their account with a generated password, then email
// them the welcome email with that password through Resend. The password is never printed,
// unless the email fails to send, so it can still reach the tester.
//
//   npm run beta:invite -- dev  --email jordan@example.com --name "Jordan" [--workspace "Jordan's Studio"] [--site https://...]
//   npm run beta:invite -- prod --email jordan@example.com --name "Jordan"
//
// Needs the RESEND_API_KEY secret in that environment's InsForge secrets (or in the shell).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { assertReleasableMain, createAccount, resolveTarget } from "./lib/accounts.ts";
import { generatePassword, PROD_SITE_URL, renderWelcomeEmail, sendWelcomeEmail } from "./lib/beta-invite.ts";

const repoRoot = path.resolve(import.meta.dirname, "..");

function resendKey(target: "dev" | "prod") {
  if (process.env.RESEND_API_KEY) return process.env.RESEND_API_KEY;
  try {
    // Same read as scripts/deploy-worker.sh; on prod the wrapper asks to confirm once.
    const out = execFileSync(path.join(repoRoot, "scripts/insforge-env.sh"), [target, "secrets", "get", "RESEND_API_KEY", "--json"], {
      cwd: repoRoot,
      input: "prod\n",
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    return (JSON.parse(out.slice(out.indexOf("{"))) as { value?: string }).value ?? "";
  } catch {
    return "";
  }
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { email: { type: "string" }, name: { type: "string" }, workspace: { type: "string" }, site: { type: "string" } },
  });
  const [targetName] = positionals;
  if ((targetName !== "dev" && targetName !== "prod") || !values.email || !values.name) {
    console.error('Usage: npm run beta:invite -- <dev|prod> --email <email> --name <first name> [--workspace <name>] [--site <url>]');
    process.exit(1);
  }
  const email = values.email.trim().toLowerCase();
  const name = values.name.trim();

  const target = resolveTarget(targetName, repoRoot);
  if (target.name === "prod") assertReleasableMain(repoRoot);

  const apiKey = resendKey(target.name);
  if (!apiKey) {
    console.error(`No RESEND_API_KEY in the ${target.name} InsForge secrets. Add it with: scripts/insforge-env.sh ${target.name} secrets add RESEND_API_KEY '<key>'`);
    process.exit(1);
  }

  if (target.name === "prod") {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`This creates ${email} on PROD and emails them their password. Type 'prod' to continue: `);
    rl.close();
    if (answer.trim() !== "prod") {
      console.error("Cancelled.");
      process.exit(1);
    }
  }

  const password = generatePassword();
  const result = await createAccount(target, {
    role: "owner",
    email,
    displayName: name,
    password,
    workspaceName: values.workspace?.trim() || name,
  });
  console.log(`Created ${email} in workspace "${result.workspaceSlug}" on ${target.name}.`);

  const template = readFileSync(path.join(repoRoot, "emails/closed-beta-welcome.html"), "utf8");
  const message = renderWelcomeEmail(template, { firstName: name, email, password, siteUrl: values.site ?? PROD_SITE_URL }, target.name);
  const sent = await sendWelcomeEmail(apiKey, email, message, `beta-welcome:${target.name}:${result.userId}`);
  if (sent.ok) {
    console.log(`Welcome email sent to ${email} (Resend id ${sent.id}).`);
    return;
  }
  // The account exists but the tester never got their password: show it once so it can be sent by hand.
  console.error(`The account was created, but the welcome email did not send: ${sent.reason}`);
  console.error(`Their password, shown only this once: ${password}`);
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

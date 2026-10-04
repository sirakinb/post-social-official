// Create a Post Social account on InsForge. Public sign-up is off, so this is how the
// owner, reviewers and testers get in. Passwords are typed in and never stored.
//
//   npm run account:create -- dev  owner    --email you@example.com --name "Aki" --workspace "Pentridge Media"
//   npm run account:create -- prod reviewer --email reviewer@example.com --name "Meta reviewer" --workspace-slug pentridge-media
import path from "node:path";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { createAccount, resolveTarget, type AccountRequest } from "./lib/accounts.ts";

// One reader for all questions, so input typed or piped ahead is not lost between them.
const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
let muted = false;
const output = rl as unknown as { _writeToOutput: (text: string) => void };
const writeToOutput = output._writeToOutput.bind(rl);
output._writeToOutput = (text: string) => {
  // Echo nothing while a password is typed.
  if (!muted) writeToOutput(text);
};

// Async iteration buffers lines that arrive before they are asked for.
const lines = rl[Symbol.asyncIterator]();

async function ask(question: string, hidden = false): Promise<string> {
  process.stdout.write(question);
  muted = hidden;
  const { value, done } = await lines.next();
  muted = false;
  if (hidden) process.stdout.write("\n");
  return done ? "" : value;
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      email: { type: "string" },
      name: { type: "string" },
      workspace: { type: "string" },
      "workspace-slug": { type: "string" },
    },
  });
  const [targetName, role] = positionals;
  if (!targetName || (role !== "owner" && role !== "reviewer") || !values.email || !values.name) {
    console.error("Usage: npm run account:create -- <dev|prod> <owner|reviewer> --email <email> --name <name> (--workspace <name> | --workspace-slug <slug>)");
    process.exit(1);
  }

  const target = resolveTarget(targetName, path.resolve(import.meta.dirname, ".."));
  if (target.name === "prod") {
    const answer = await ask(`This creates an account on PROD. Type 'prod' to continue: `);
    if (answer !== "prod") {
      console.error("Cancelled.");
      process.exit(1);
    }
  }

  const password = await ask("Password (at least 12 characters, including a number): ", true);
  const again = await ask("Type it again: ", true);
  if (password !== again) {
    console.error("The passwords do not match.");
    process.exit(1);
  }

  const request: AccountRequest =
    role === "owner"
      ? {
          role,
          email: values.email,
          displayName: values.name,
          password,
          workspaceName: values.workspace ?? "",
          workspaceSlug: values["workspace-slug"],
        }
      : { role, email: values.email, displayName: values.name, password, workspaceSlug: values["workspace-slug"] ?? "" };

  const result = await createAccount(target, request);
  console.log(`Created ${result.role} ${values.email} in workspace "${result.workspaceSlug}" on ${target.name}.`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => rl.close());

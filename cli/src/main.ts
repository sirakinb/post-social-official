// postsocial: Post Social from the terminal and from AI agents (Claude Code, Codex, CI).
// Every command prints JSON to stdout (--pretty for people); errors are JSON on stderr
// with exit code 1. Commands are the same tools AIs get over MCP.
import { randomUUID } from "node:crypto";
import { ApiFailure, callOperation, loadOperations, type Operation } from "./api";
import { buildInput, InputError, parseArgs, toCommand, toOperationId } from "./args";
import { DEFAULT_BASE_URL, forgetCredentials, loadCredentials, loginWithBrowser, saveCredentials, type Credentials } from "./auth";
import { uploadFile } from "./upload";

const VERSION = "0.1.0";

function print(value: unknown, pretty: boolean) {
  process.stdout.write(`${JSON.stringify(value, null, pretty ? 2 : undefined)}\n`);
}

function fail(message: string, extra: Record<string, unknown> = {}): never {
  process.stderr.write(`${JSON.stringify({ error: { message, ...extra } })}\n`);
  process.exit(1);
}

const say = (line: string) => process.stderr.write(`${line}\n`);

function help(ops: Operation[] | null) {
  const lines = [
    `postsocial ${VERSION}: post, schedule and track social posts from your terminal or AI agent.`,
    "",
    "Getting started:",
    "  postsocial login                 Sign in through your browser",
    "  postsocial login --key ps_live_… Use an API key instead (servers, CI); or set POSTSOCIAL_API_KEY",
    "  postsocial logout                Forget the saved sign-in",
    "  postsocial upload --file ./clip.mp4 [--name 'Launch video'] [--no-wait]",
    "",
    "Commands (each is also an MCP tool; JSON in, JSON out):",
    ...(ops ?? []).map((op) => `  ${toCommand(op.operationId).padEnd(22)} ${op.summary}`),
    "",
    "Options: --pretty (readable output), --input '<json>' (all options as one object),",
    "  --idempotency-key <key> (repeat-safe writes), --base-url <url>.",
    "Help for one command: postsocial <command> --help",
  ];
  say(lines.join("\n"));
}

function commandHelp(op: Operation) {
  const lines = [`postsocial ${toCommand(op.operationId)}: ${op.summary}`, "", op.description, "", "Options:"];
  for (const [name, schema] of Object.entries(op.properties)) {
    const req = op.required.includes(name) ? " (required)" : "";
    const choices = schema.enum ? ` One of: ${schema.enum.join(", ")}.` : "";
    const type = schema.type === "array" || schema.type === "object" ? " JSON" : schema.type ? ` ${schema.type}` : "";
    lines.push(`  --${name.replace(/_/g, "-")}${type}${req}  ${schema.description ?? ""}${choices}`);
  }
  say(lines.join("\n"));
}

async function credentialsFor(flags: Record<string, string | true>, baseUrl: string): Promise<Credentials> {
  const key = typeof flags.key === "string" ? flags.key : process.env.POSTSOCIAL_API_KEY;
  if (key) return { kind: "key", baseUrl, key };
  const saved = await loadCredentials();
  if (!saved) fail("You're not signed in. Run `postsocial login` (or pass --key / set POSTSOCIAL_API_KEY).");
  if (saved.baseUrl !== baseUrl) fail(`You're signed in to ${saved.baseUrl}, not ${baseUrl}. Run \`postsocial login --base-url ${baseUrl}\`.`);
  return saved;
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const pretty = flags.pretty === true;
  const saved = await loadCredentials();
  const baseUrl = (typeof flags.base_url === "string" ? flags.base_url : process.env.POSTSOCIAL_BASE_URL ?? saved?.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");

  if (command === "version" || flags.version === true) return print({ version: VERSION }, pretty);

  if (command === "login") {
    if (typeof flags.key === "string") {
      const credentials: Credentials = { kind: "key", baseUrl, key: flags.key };
      const ops = await loadOperations(baseUrl);
      const me = await callOperation(credentials, ops.find((o) => o.operationId === "get_workspace")!, {});
      await saveCredentials(credentials);
      return print({ signed_in: true, method: "api_key", ...(me as object) }, pretty);
    }
    const credentials = await loginWithBrowser(baseUrl, say);
    await saveCredentials(credentials);
    return print({ signed_in: true, method: "browser", base_url: baseUrl }, pretty);
  }

  if (command === "logout") {
    await forgetCredentials();
    return print({ signed_out: true }, pretty);
  }

  const ops = await loadOperations(baseUrl).catch((error) => (command && command !== "help" ? fail(error.message) : null));
  if (!command || command === "help" || (flags.help === true && !command)) return help(ops);

  if (command === "upload") {
    if (typeof flags.file !== "string") fail("Usage: postsocial upload --file ./video.mp4 [--name 'Launch video'] [--no-wait]");
    const credentials = await credentialsFor(flags, baseUrl);
    const media = await uploadFile(credentials, ops!, flags.file, {
      name: typeof flags.name === "string" ? flags.name : undefined,
      wait: flags.no_wait !== true,
      progress: process.stderr.isTTY ? (sent, total) => process.stderr.write(`\rUploading… ${Math.round((sent / total) * 100)}%`) : undefined,
    });
    if (process.stderr.isTTY) process.stderr.write("\n");
    return print(media, pretty);
  }

  const op = ops!.find((o) => o.operationId === toOperationId(command));
  if (!op) fail(`Unknown command "${command}". Run \`postsocial help\` to see the commands.`);
  if (flags.help === true) return commandHelp(op);

  const input = buildInput(flags, op.properties);
  const credentials = await credentialsFor(flags, baseUrl);
  // Each write carries an idempotency key, so the automatic retry after a renewed sign-in
  // cannot act twice. Pass --idempotency-key to make retries across runs safe too.
  const idempotencyKey = typeof flags.idempotency_key === "string" ? flags.idempotency_key : op.method === "GET" ? undefined : randomUUID();
  print(await callOperation(credentials, op, input, { idempotencyKey }), pretty);
}

main().catch((error) => {
  if (error instanceof ApiFailure) fail(error.message, { status: error.status, ...(typeof error.body === "object" && error.body && "error" in error.body ? { code: (error.body as { error: { code?: string } }).error.code } : {}) });
  if (error instanceof InputError) fail(error.message);
  fail(error instanceof Error ? error.message : String(error));
});

// Turns `postsocial create-post --caption "Hi" --destinations '[...]'` into a command name
// and an input object, using the API description to give each flag its proper type.

export type Parsed = { command: string | null; flags: Record<string, string | true>; positional: string[] };

export function parseArgs(argv: string[]): Parsed {
  const flags: Record<string, string | true> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      const name = (eq > 0 ? arg.slice(2, eq) : arg.slice(2)).replace(/-/g, "_");
      if (eq > 0) flags[name] = arg.slice(eq + 1);
      else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) flags[name] = argv[++i];
      else flags[name] = true;
    } else {
      positional.push(arg);
    }
  }
  return { command: positional.shift() ?? null, flags, positional };
}

// Command names: create-post or create_post both work.
export const toOperationId = (command: string) => command.replace(/-/g, "_");
export const toCommand = (operationId: string) => operationId.replace(/_/g, "-");

type Schema = { type?: string; items?: unknown };

export class InputError extends Error {}

// Converts flag text to the type the API expects. Lists and objects are JSON.
export function coerce(name: string, raw: string | true, schema: Schema | undefined): unknown {
  const type = schema?.type;
  if (raw === true) {
    if (type === "boolean" || type === undefined) return true;
    throw new InputError(`--${name.replace(/_/g, "-")} needs a value.`);
  }
  switch (type) {
    case "integer":
    case "number": {
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new InputError(`--${name.replace(/_/g, "-")} must be a number.`);
      return n;
    }
    case "boolean":
      if (raw === "true" || raw === "false") return raw === "true";
      throw new InputError(`--${name.replace(/_/g, "-")} must be true or false.`);
    case "array":
    case "object":
      try {
        return JSON.parse(raw);
      } catch {
        // A comma list is accepted for simple lists of ids.
        if (type === "array" && !raw.trim().startsWith("[")) return raw.split(",").map((v) => v.trim()).filter(Boolean);
        throw new InputError(`--${name.replace(/_/g, "-")} must be JSON, e.g. ${type === "array" ? "'[...]'" : "'{...}'"}.`);
      }
    default:
      return raw;
  }
}

// CLI-only flags that are never sent to the API.
export const GLOBAL_FLAGS = new Set(["pretty", "base_url", "key", "input", "idempotency_key", "help", "no_wait", "file", "name"]);

export function buildInput(flags: Record<string, string | true>, properties: Record<string, Schema>, globals = GLOBAL_FLAGS) {
  let input: Record<string, unknown> = {};
  if (typeof flags.input === "string") {
    try {
      input = JSON.parse(flags.input);
    } catch {
      throw new InputError("--input must be a JSON object.");
    }
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new InputError("--input must be a JSON object.");
  }
  for (const [name, raw] of Object.entries(flags)) {
    if (globals.has(name) && !(name in properties)) continue;
    if (!(name in properties)) throw new InputError(`Unknown option --${name.replace(/_/g, "-")}. Options: ${Object.keys(properties).map((p) => `--${p.replace(/_/g, "-")}`).join(", ") || "none"}.`);
    input[name] = coerce(name, raw, properties[name]);
  }
  return input;
}

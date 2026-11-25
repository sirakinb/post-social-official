// Reading settings the same way wherever the backend runs: InsForge functions read secrets
// (Deno.env), the Node service and the worker read environment variables (process.env).
export type Env = (name: string) => string | undefined;

// A setting that must be there. The name is safe to show; the value never is.
export function required(env: Env) {
  return (name: string) => {
    const value = env(name);
    if (!value) throw new Error(`Missing secret ${name}`);
    return value;
  };
}

// A comma-separated setting as a list, empty when it isn't set.
export function listOf(env: Env, name: string) {
  return (env(name) ?? "").split(",").map((value) => value.trim()).filter(Boolean);
}

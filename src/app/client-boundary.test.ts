// Server code that imports a plain value (a list, a helper) from a "use client" file gets a
// client reference instead of the value, so the page fails only when built and served, never
// in tests that render the client file directly. Server files may import only components
// (PascalCase) and types from client files; shared values belong in a plain module.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "..");
const isClient = (code: string) => /^\s*(\/\/[^\n]*\n\s*)*["']use client["']/.test(code);

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : files(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function resolveImport(from: string, spec: string) {
  const base = spec.startsWith("@/") ? join(SRC, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
  if (!base) return null;
  return [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")].find((p) => existsSync(p) && p.match(/\.tsx?$/)) ?? null;
}

describe("server code and client files", () => {
  it("imports only components and types from client files", () => {
    const problems: string[] = [];
    for (const file of files(SRC)) {
      const code = readFileSync(file, "utf8");
      if (isClient(code)) continue;
      for (const match of code.matchAll(/^import\s+(?!type\b)\{([^}]*)\}\s+from\s+["']([^"']+)["']/gm)) {
        const target = resolveImport(file, match[2]);
        if (!target || !isClient(readFileSync(target, "utf8"))) continue;
        const values = match[1].split(",").map((name) => name.trim()).filter((name) => name && !name.startsWith("type "));
        for (const name of values.map((n) => n.split(/\s+as\s+/)[0])) {
          if (!/^[A-Z][a-z]/.test(name)) problems.push(`${file.slice(SRC.length + 1)} imports ${name} from ${match[2]}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

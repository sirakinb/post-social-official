// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const installed = (name: string) =>
  JSON.parse(readFileSync(`node_modules/${name}/package.json`, "utf8")).version as string;

const atLeast = (version: string, minimum: string) => {
  const a = version.split(".").map(Number);
  const b = minimum.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return true;
};

describe("security fixes in dependencies", () => {
  it("runs a Next.js version with the published security fixes", () => {
    expect(atLeast(installed("next"), "16.4.3")).toBe(true);
  });

  it("runs an undici version with the published security fix", () => {
    expect(atLeast(installed("undici"), "8.12.3")).toBe(true);
  });
});

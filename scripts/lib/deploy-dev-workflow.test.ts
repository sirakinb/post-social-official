// Guardrails of the dev deploy (.github/workflows/deploy-dev.yml and the scripts' dev-key mode):
// only commits already on dev, one run at a time, the dev-only key from the Development
// environment, and never prod.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const workflow = readFileSync(path.join(root, ".github/workflows/deploy-dev.yml"), "utf8");

describe("deploy-dev workflow", () => {
  it("runs only by hand, from dev, in the Development environment", () => {
    expect(workflow).toMatch(/^on:\n {2}workflow_dispatch:/m);
    expect(workflow).not.toMatch(/^\s+(push|pull_request|schedule|workflow_run):/m);
    expect(workflow).toContain("if: github.ref == 'refs/heads/dev'");
    expect(workflow).toContain("environment: Development");
  });

  it("never overlaps on the shared dev backend", () => {
    expect(workflow).toMatch(/concurrency:\n {2}group: insforge-dev-deploy\n {2}cancel-in-progress: false/);
  });

  it("deploys only a commit that is already on dev, with inputs passed through env", () => {
    expect(workflow).toContain('git merge-base --is-ancestor "$full" origin/dev');
    expect(workflow).toContain("INPUT_SHA: ${{ inputs.sha }}");
    expect(workflow).not.toMatch(/run: .*\$\{\{ *inputs\./);
  });

  it("uses only the dev key and the dev backend, never prod", () => {
    expect(workflow).toContain("secrets.INSFORGE_DEV_API_KEY");
    expect(workflow).toContain('INSFORGE_DEV_DIRECT: "1"');
    expect(workflow).not.toMatch(/INSFORGE_USER_API_KEY|VERCEL_TOKEN|db:promote|syydd6ck\.(us-east|function2)/);
  });

  it("checks dev answers and records the commit", () => {
    expect(workflow).toContain("/api/v1/openapi.json");
    expect(workflow).toContain("GITHUB_STEP_SUMMARY");
  });
});

describe("insforge-env.sh dev-key mode", () => {
  const run = (...args: string[]) =>
    spawnSync("bash", [path.join(root, "scripts/insforge-env.sh"), ...args], { env: { ...process.env, INSFORGE_DEV_DIRECT: "1" }, encoding: "utf8" });

  it("refuses prod and promote", () => {
    for (const args of [["prod", "functions", "list"], ["promote"]]) {
      const result = run(...args);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("INSFORGE_DEV_DIRECT only works with dev.");
    }
  });
});

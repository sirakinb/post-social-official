// Guardrails of the dev deploy workflow (.github/workflows/deploy-dev-api.yml): it deploys only
// commits already on dev, one run at a time, with the dev-only key from the Development
// environment, and never touches prod.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(path.resolve(__dirname, "../../.github/workflows/deploy-dev-api.yml"), "utf8");

describe("deploy-dev-api workflow", () => {
  it("runs only by hand, from dev, in the Development environment", () => {
    expect(workflow).toMatch(/^on:\n {2}workflow_dispatch:/m);
    expect(workflow).not.toMatch(/^\s+(push|pull_request|schedule):/m);
    expect(workflow).toContain("if: github.ref == 'refs/heads/dev'");
    expect(workflow).toContain("environment: Development");
  });

  it("never overlaps on the shared dev backend", () => {
    expect(workflow).toMatch(/concurrency:\n {2}group: insforge-dev-deploy\n {2}cancel-in-progress: false/);
  });

  it("deploys only a commit that is already on dev, passed through env (no injection)", () => {
    expect(workflow).toContain('git merge-base --is-ancestor "$full" origin/dev');
    expect(workflow).toContain("INPUT_SHA: ${{ inputs.sha }}");
    expect(workflow).not.toMatch(/run: .*\$\{\{ *inputs\./);
  });

  it("uses only the dev key and the dev backend, never prod", () => {
    expect(workflow).toContain("secrets.INSFORGE_DEV_API_KEY");
    expect(workflow).not.toMatch(/INSFORGE_USER_API_KEY|VERCEL_TOKEN|syydd6ck\.(us-east|function2)/);
    expect(workflow).toContain("https://syydd6ck-zqc.function2.insforge.app");
  });

  it("checks dev answers and records the commit", () => {
    expect(workflow).toContain("/api/v1/openapi.json");
    expect(workflow).toContain("GITHUB_STEP_SUMMARY");
  });
});

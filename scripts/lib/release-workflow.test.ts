// Guardrails of the prod release (.github/workflows/release.yml) around the move to AWS:
// the AWS deploy only from main and only when switched on, and, once prod lives on AWS,
// nothing that would start InsForge's worker again.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(path.resolve(__dirname, "../../.github/workflows/release.yml"), "utf8");
const [, awsJob = "", releaseJob = ""] = /\n {2}aws:\n([\s\S]*?)\n {2}release:\n([\s\S]*)$/.exec(workflow) ?? [];
// A step's own lines: from its "- name:" to the next step.
const step = (job: string, name: string) => new RegExp(`- name: ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\n]*\n([\\s\\S]*?)(?=\n {6}- |$)`).exec(job)?.[1] ?? "";

describe("release workflow and AWS", () => {
  it("deploys to AWS prod only from main, only when switched on, as the prod role", () => {
    expect(awsJob).toContain("if: github.repository == 'sirakinb/post-social-official' && github.ref == 'refs/heads/main' && vars.AWS_PROD_DEPLOY == 'on'");
    expect(awsJob).toContain("environment: production");
    expect(workflow).toContain("AWS_ROLE: arn:aws:iam::039612844713:role/postsocial-github-deploy-prod");
    expect(awsJob).toContain('run: node scripts/aws-deploy.mjs prod "$GITHUB_SHA"');
    expect(awsJob).not.toMatch(/aws-deploy\.mjs dev/);
    // Only this job may ask for an AWS identity.
    expect(releaseJob).not.toContain("id-token");
  });

  it("changes the website only after the AWS deploy worked, or when it is switched off", () => {
    expect(releaseJob).toMatch(/^ {4}needs: aws$/m);
    expect(releaseJob).toContain("if: ${{ !cancelled() && (needs.aws.result == 'success' || needs.aws.result == 'skipped') }}");
    expect(releaseJob.indexOf("- name: Worker")).toBeLessThan(releaseJob.indexOf("- name: Website (Vercel production)"));
  });

  it("never touches InsForge's database, functions or worker once prod lives on AWS", () => {
    for (const name of ["Install flyctl", "Sign in to InsForge and link the project", "Database", "Functions", "Worker"]) {
      expect(step(releaseJob, name), name).toMatch(/^ {8}if: vars\.PROD_BACKEND != 'aws'$/m);
    }
    // And a release can't leave the backend behind: with prod on AWS, the AWS job must have run.
    expect(step(releaseJob, "Check the secrets are set")).toContain('"$PROD_BACKEND" == "aws" && "$AWS_RESULT" != "success"');
  });
});

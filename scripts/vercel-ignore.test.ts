import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { affectsWebsite, decide } from "./vercel-ignore.mjs";

describe("which files count as website changes", () => {
  it.each(["src/app/page.tsx", "public/sw.js", "backend/lib/billing.ts", "package.json", "next.config.ts", "vercel.json", "scripts/vercel-ignore.mjs", "worker/src/credentials.ts", "worker/src/publish/types.ts"])(
    "%s does",
    (file) => expect(affectsWebsite(file)).toBe(true),
  );

  it.each(["worker/src/publish/x.ts", "migrations/20261115120000_x.sql", "backend/functions/api/handler.ts", "backend/lib/billing.test.ts", "docs/environments.md", "e2e/journeys/billing.e2e.ts", ".github/workflows/release.yml", "scripts/deploy-prod.sh", "README.md", "backend/server.ts", "backend/service.ts", "backend/migrate.ts", "backend/Dockerfile", "backend/build.sh", "database/bootstrap.sql"])(
    "%s doesn't",
    (file) => expect(affectsWebsite(file)).toBe(false),
  );
});

describe("decide", () => {
  it("never builds staging or main", () => {
    expect(decide({ ref: "staging", message: "[preview]", changedFiles: ["src/a.tsx"] }).build).toBe(false);
    expect(decide({ ref: "main", message: "", changedFiles: ["src/a.tsx"] }).build).toBe(false);
  });

  it("always builds the release workflow's production deploy", () => {
    expect(decide({ ref: "main", message: "", changedFiles: [], target: "production" }).build).toBe(true);
    expect(decide({ ref: "main", message: "", changedFiles: null, target: "production" }).build).toBe(true);
  });

  it("builds a feature branch only when asked", () => {
    expect(decide({ ref: "billing-copy", message: "Billing copy", changedFiles: ["src/a.tsx"] }).build).toBe(false);
    expect(decide({ ref: "billing-copy", message: "Billing copy [Preview]", changedFiles: ["src/a.tsx"] }).build).toBe(true);
  });

  it("builds dev when website files changed and skips it otherwise", () => {
    expect(decide({ ref: "dev", message: "", changedFiles: ["worker/src/publish/x.ts", "src/app/page.tsx"] }).build).toBe(true);
    expect(decide({ ref: "dev", message: "", changedFiles: ["worker/src/publish/x.ts", "migrations/1.sql", "docs/a.md"] }).build).toBe(false);
  });

  it("builds dev when it can't tell what changed", () => {
    expect(decide({ ref: "dev", message: "", changedFiles: null }).build).toBe(true);
  });
});

describe("vercel.json", () => {
  const config = JSON.parse(readFileSync(path.resolve(__dirname, "../vercel.json"), "utf8"));

  it("runs this script and keeps main and staging off", () => {
    expect(config.ignoreCommand).toBe("node scripts/vercel-ignore.mjs");
    expect(config.git.deploymentEnabled).toMatchObject({ main: false, staging: false });
  });
});

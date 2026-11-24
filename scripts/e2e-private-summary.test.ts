import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readSourceLine, summarize } from "./e2e-private-summary.mjs";

// What the pages could put in a report (Billing's card and receipts, the account's email, its
// channels and posts, page URLs): none of it may reach the summary.
const PAGE = [
  "Mastercard",
  "•••• 4444",
  "01/30",
  "https://pay.stripe.com/receipts/acct_x/rcpt_y",
  "Next charge $10.00",
  "tester@example.com",
  "@example_channel",
  "Our launch post is live",
  "https://www.postsocial.xyz/beta/settings",
];
const quotes = PAGE.join(" ");

const step = (over: Record<string, unknown>) => ({ api: "expect.toBeVisible", label: `getByRole("button", name: "${quotes}")`, status: "passed", explanation: quotes, ...over });

const report = {
  schemaVersion: 1,
  run: {
    status: "failed",
    errors: [{ error: { code: "APP_LOG_ERROR", phase: "run", message: quotes } }],
    results: [
      { selected: true, status: "passed", file: "e2e/journeys/sign-in.e2e.ts", source: { file: "e2e/journeys/sign-in.e2e.ts", line: 4 }, titlePath: ["the test customer signs in"], attempts: [] },
      {
        selected: true,
        status: "failed",
        file: "e2e/journeys/billing.e2e.ts",
        source: { file: "e2e/journeys/billing.e2e.ts", line: 13 },
        titlePath: ["billing", "shows the current plan and how to pay for it"],
        attempts: [
          {
            error: { code: "ASSERTION_FAILED", message: `expect.toBeVisible failed / observed: text "${quotes}"`, source: { file: "e2e/journeys/billing.e2e.ts", line: 20 } },
            failure: { url: PAGE[3], screen: quotes, screenshot: "attempt-1/screenshots/001-failure.png" },
            steps: [
              step({}),
              step({ status: "failed", source: { file: "e2e/journeys/billing.e2e.ts", line: 20 }, error: { code: "ASSERTION_FAILED", message: quotes } }),
            ],
          },
        ],
      },
      {
        selected: true,
        status: "failed",
        file: "e2e/journeys/billing.e2e.ts",
        source: { file: "e2e/journeys/billing.e2e.ts", line: 30 },
        titlePath: ["billing", "explains what X posts cost on the current plan"],
        attempts: [
          {
            error: { code: "ASSERTION_FAILED", message: quotes },
            steps: [step({ api: "agent.assert", status: "failed", source: { file: "e2e/journeys/billing.e2e.ts", line: 37 }, error: { code: "ASSERTION_FAILED", message: quotes } })],
          },
        ],
      },
      {
        selected: true,
        status: "failed",
        file: "e2e/journeys/every-page.e2e.ts",
        source: { file: "e2e/journeys/every-page.e2e.ts", line: 22 },
        titlePath: ["every page", "Settings opens and makes sense"],
        attempts: [
          {
            error: { code: "ASSERTION_FAILED", message: quotes },
            failure: { url: PAGE[8], screen: quotes, screenshot: "attempt-1/screenshots/001-failure.png" },
            steps: [step({ api: "agent.assert", status: "failed", source: { file: "e2e/journeys/every-page.e2e.ts", line: 27 }, error: { code: "ASSERTION_FAILED", message: quotes } })],
          },
        ],
      },
      { selected: false, status: "skipped", file: "e2e/journeys/every-page.e2e.ts", titlePath: ["every page", "Accounts opens and makes sense"], attempts: [] },
    ],
  },
};

const LINES: Record<number, string> = {
  20: 'await expect(screen.getByRole("region", "Card and receipts").getByRole("button", "Update")).toBeVisible();',
  27: "await agent.assert(`${page.makesSense}; there is no error message, broken layout or text that only makes sense to the people who built the app`);",
  37: 'await agent.assert("the X spending section shows a monthly X limit");',
};
const sourceLine = (at?: { line: number }) => (at ? LINES[at.line] : undefined);

describe("the private e2e summary", () => {
  const text = summarize(report, { sourceLine }).join("\n");

  it("says which tests passed and failed, and which check failed", () => {
    expect(text).toContain("✓ passed e2e/journeys/sign-in.e2e.ts:4 the test customer signs in");
    expect(text).toContain("✗ failed e2e/journeys/billing.e2e.ts:13 billing > shows the current plan and how to pay for it");
    expect(text).toContain("ASSERTION_FAILED in expect.toBeVisible at e2e/journeys/billing.e2e.ts:20");
    expect(text).toContain(`20 | ${LINES[20]}`);
    expect(text).toContain("ASSERTION_FAILED in agent.assert at e2e/journeys/billing.e2e.ts:37");
    expect(text).toContain("✗ failed e2e/journeys/every-page.e2e.ts:22 every page > Settings opens and makes sense");
    expect(text).toContain("ASSERTION_FAILED in agent.assert at e2e/journeys/every-page.e2e.ts:27");
    expect(text).toContain("✗ run error APP_LOG_ERROR (run)");
    expect(text).toContain("Run failed: 1 passed, 3 failed.");
  });

  it("leaves out tests the run didn't select", () => {
    expect(text).not.toContain("Accounts opens");
  });

  it.each(PAGE)("never prints what the page showed: %s", (value) => {
    expect(text).not.toContain(value);
  });

  it("explains a run that wrote no report", () => {
    expect(summarize(undefined).join("\n")).toMatch(/No e2e report was written/);
  });

  it("prints only identifier-like codes", () => {
    const odd = { run: { status: "failed", results: [{ ...report.run.results[2], attempts: [{ steps: [], error: { code: `Card ${PAGE[1]}` } }] }] } };
    const out = summarize(odd, { sourceLine }).join("\n");
    expect(out).toContain("    ?");
    expect(out).not.toContain(PAGE[1]);
  });
});

describe("readSourceLine", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "e2e-summary-"));
  mkdirSync(path.join(root, "e2e/journeys"), { recursive: true });
  writeFileSync(path.join(root, "e2e/journeys/billing.e2e.ts"), `line one\n    await expect(x).toBeVisible();\n${"y".repeat(400)}\n`);
  writeFileSync(path.join(root, "notes.txt"), "not a test\n");

  it("reads the committed test line, trimmed and capped", () => {
    expect(readSourceLine({ file: "e2e/journeys/billing.e2e.ts", line: 2 }, root)).toBe("await expect(x).toBeVisible();");
    expect(readSourceLine({ file: "e2e/journeys/billing.e2e.ts", line: 3 }, root)).toHaveLength(160);
  });

  it("reads only e2e test files", () => {
    expect(readSourceLine({ file: "notes.txt", line: 1 }, root)).toBeUndefined();
    expect(readSourceLine({ file: "e2e/journeys/../../notes.txt", line: 1 }, root)).toBeUndefined();
    expect(readSourceLine({ file: "e2e/journeys/billing.e2e.ts", line: 99 }, root)).toBeUndefined();
  });
});

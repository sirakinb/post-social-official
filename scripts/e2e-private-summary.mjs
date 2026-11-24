// Prints which e2e checks passed or failed, and nothing the pages showed.
//
// The E2E after release journeys run against the real prod test customer, whose pages show its
// account (email, channels, posts, usage, and on Billing its card and receipt links). This
// repository is public, so the workflow runs them all with their output hidden and no trace,
// and never uploads their results; this summary is all the log gets. For each test: its
// status, file:line and title;
// for a failure, the error code and the test line that failed (from the committed test file).
// Never the error message, the agent's explanation, the step label, the page URL or the screen,
// which can all quote the page.
//
//   node scripts/e2e-private-summary.mjs .e2e/private/report.json
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MARK = { passed: "✓", flaky: "✓", failed: "✗", "timed-out": "✗", interrupted: "✗", skipped: "-" };
const FAILED = new Set(["failed", "timed-out", "interrupted"]);
const MAX_LINE = 160;

// A token safe to print: an error code, status or phase is a short identifier, never page text.
const token = (value) => (typeof value === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(value) ? value : "?");

// Only a project-relative path to a test file under e2e/.
const testFile = (file) => (typeof file === "string" && /^e2e\/[\w./-]+\.e2e\.ts$/.test(file) && !file.includes("..") ? file : undefined);

const where = (source) => {
  const file = testFile(source?.file);
  return file && Number.isInteger(source.line) ? `${file}:${source.line}` : undefined;
};

/** The committed test line at a source location, trimmed; undefined when it can't be read. */
export function readSourceLine(source, root = process.cwd()) {
  const file = testFile(source?.file);
  if (!file || !Number.isInteger(source.line)) return undefined;
  try {
    const line = readFileSync(path.join(root, file), "utf8").split("\n")[source.line - 1];
    if (line === undefined) return undefined;
    const text = line.trim();
    return text.length > MAX_LINE ? `${text.slice(0, MAX_LINE - 1)}…` : text;
  } catch {
    return undefined;
  }
}

/** The summary's lines for a report.json document (undefined when no report was written). */
export function summarize(report, { sourceLine = readSourceLine } = {}) {
  if (!report?.run) {
    return ["No e2e report was written: the run stopped before its tests. Nothing from the pages is printed here; rerun by hand to see why."];
  }
  const lines = [];
  const counts = {};
  for (const result of report.run.results ?? []) {
    if (!result.selected) continue;
    const status = token(result.status);
    counts[status] = (counts[status] ?? 0) + 1;
    const titles = Array.isArray(result.titlePath) ? result.titlePath.filter((t) => typeof t === "string").join(" > ") : "";
    lines.push(`${MARK[status] ?? "?"} ${status} ${where(result.source) ?? testFile(result.file) ?? "?"} ${titles}`);
    if (status === "skipped" && result.skip) lines.push(`    skipped: ${token(result.skip.cause)}`);
    if (!FAILED.has(status)) continue;
    const attempt = result.attempts?.at(-1);
    const step = attempt?.steps?.find((s) => FAILED.has(s.status) || s.status === "blocked");
    const error = step?.error ?? attempt?.error;
    const at = step?.source ?? attempt?.error?.source;
    lines.push(`    ${token(error?.code)}${step ? ` in ${token(step.api)}` : ""}${where(at) ? ` at ${where(at)}` : ""}`);
    const code = sourceLine(at);
    if (code) lines.push(`    ${at.line} | ${code}`);
  }
  for (const entry of report.run.errors ?? []) {
    const error = entry?.error ?? entry;
    lines.push(`✗ run error ${token(error?.code)}${error?.phase ? ` (${token(error.phase)})` : ""}`);
  }
  const tally = Object.entries(counts).map(([status, n]) => `${n} ${status}`).join(", ");
  lines.push(`Run ${token(report.run.status)}${tally ? `: ${tally}` : ""}.`);
  return lines;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const file = process.argv[2] ?? ".e2e/private/report.json";
  let report;
  if (existsSync(file)) {
    try {
      report = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      report = undefined;
    }
  }
  console.log(summarize(report).join("\n"));
}

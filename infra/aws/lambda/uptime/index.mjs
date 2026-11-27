// The uptime check: asks each address once and records whether it answered.
//
// AWS runs this every minute (infra/aws/lib/uptime-stack.ts). It only measures. Each result
// is one log line in a shape CloudWatch turns into a number (1 up, 0 down), and an alarm on
// that number decides when to send a message. So one slow answer is not an alert, and a
// check that stops running is: no number counts as down.
//
// CHECKS is a JSON list of { name, url, mustContain? }. Nothing here is secret.

const TIMEOUT_MS = 10_000;

// What is wrong with one address, in plain words, or null when it answered properly.
export async function problemWith(check, fetchFn = fetch) {
  try {
    const response = await fetchFn(check.url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "user-agent": "postsocial-uptime" } });
    const body = await response.text();
    if (!response.ok) return `answered ${response.status}`;
    if (check.mustContain && !body.includes(check.mustContain)) return `answered ${response.status} without ${check.mustContain}`;
    return null;
  } catch (error) {
    if (error?.name === "TimeoutError") return `no answer in ${TIMEOUT_MS / 1000} seconds`;
    return `could not connect (${error?.cause?.code ?? error?.name ?? "unknown error"})`;
  }
}

// One log line per check, in CloudWatch's embedded metric format: it becomes the metric
// "Up" under PostSocial/Uptime, split by environment and check name.
export function metricLine({ environment, name, problem, now }) {
  return {
    _aws: { Timestamp: now, CloudWatchMetrics: [{ Namespace: "PostSocial/Uptime", Dimensions: [["Environment", "Check"]], Metrics: [{ Name: "Up", Unit: "Count" }] }] },
    Environment: environment,
    Check: name,
    Up: problem ? 0 : 1,
    ...(problem ? { problem } : {}),
  };
}

// Written straight to the output, not through console.log: that adds a prefix in front of
// the line, and CloudWatch only reads a metric from a line that is the JSON alone.
const toTheLog = (line) => {
  process.stdout.write(`${JSON.stringify(line)}\n`);
};

export async function runChecks({ checks, environment, fetchFn = fetch, write = toTheLog, now = Date.now() }) {
  const problems = await Promise.all(checks.map((check) => problemWith(check, fetchFn)));
  checks.forEach((check, index) => write(metricLine({ environment, name: check.name, problem: problems[index], now })));
  return Object.fromEntries(checks.map((check, index) => [check.name, problems[index] ?? "up"]));
}

export const handler = () => runChecks({ checks: JSON.parse(process.env.CHECKS ?? "[]"), environment: process.env.ENVIRONMENT ?? "unknown" });

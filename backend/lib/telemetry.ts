// Error reports and a few product events, sent to PostHog over plain HTTPS so the same code
// runs in the worker (Node) and the InsForge functions (Deno) without an SDK. Never throws,
// never blocks for long, and does nothing without a key (tests, local runs).
//
// Only what is needed to find a bug leaves: the error's type, message and stack, plus the
// context passed in (ids, platform, status). Messages are scrubbed of tokens and keys,
// because platform errors sometimes echo request URLs.

export type Telemetry = {
  captureException: (error: unknown, context?: Record<string, unknown>) => Promise<void>;
  capture: (event: string, properties?: Record<string, unknown>, distinctId?: string) => Promise<void>;
};

export type TelemetryConfig = {
  key?: string | null; // the project's public key (phc_...)
  host?: string; // ingestion host, e.g. https://us.i.posthog.com
  service: string; // "worker", "api", "media", "web"
  environment?: string; // "dev" or "prod"
  fetchImpl?: typeof fetch;
};

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/(access_token|refresh_token|client_secret|code|token|key|signature|sig)=([^&\s"']+)/gi, "$1=[redacted]"],
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]"],
  [/\b(ps_(?:live|test|at|rt)_[A-Za-z0-9_-]+)/g, "[redacted-key]"],
  [/\b(phx_[A-Za-z0-9]+|sk_(?:live|test)_[A-Za-z0-9]+|EAA[A-Za-z0-9]{20,})/g, "[redacted-key]"],
  // Database errors can quote the row that failed: captions, emails, names.
  [/Failing row contains \([^)]*\)?/gi, "Failing row contains ([redacted])"],
  [/(DETAIL|HINT):[^\n"]*/g, "$1: [redacted]"],
  [/Key \(([^)]*)\)=\([^)]*\)/g, "Key ($1)=([redacted])"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]"],
];

export function scrub(text: string): string {
  return SECRET_PATTERNS.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text).slice(0, 2000);
}

type Frame = { filename: string; function: string; lineno?: number; colno?: number; in_app: boolean; platform: "node:javascript" };

// V8-style stack lines ("at fn (file:line:col)" or "at file:line:col"), Node and Deno alike.
export function parseStack(stack: string | undefined): Frame[] {
  if (!stack) return [];
  const frames: Frame[] = [];
  for (const line of stack.split("\n").slice(1, 40)) {
    const match = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/.exec(line);
    if (!match) continue;
    const filename = match[2];
    frames.push({
      filename,
      function: match[1] ?? "<anonymous>",
      lineno: Number(match[3]),
      colno: Number(match[4]),
      in_app: !/node_modules|node:internal|ext:|deno:/.test(filename),
      platform: "node:javascript",
    });
  }
  return frames.reverse(); // PostHog expects the innermost frame last
}

export function exceptionProperties(error: unknown) {
  const err = error instanceof Error ? error : new Error(typeof error === "string" ? error : JSON.stringify(error));
  return {
    $exception_list: [
      {
        type: err.name || "Error",
        value: scrub(err.message),
        mechanism: { handled: true, synthetic: !(error instanceof Error) },
        stacktrace: { type: "raw", frames: parseStack(err.stack) },
      },
    ],
  };
}

export function createTelemetry(config: TelemetryConfig): Telemetry {
  const host = (config.host ?? "https://us.i.posthog.com").replace(/\/+$/, "");
  const doFetch = config.fetchImpl ?? fetch;
  const send = async (event: string, properties: Record<string, unknown>, distinctId?: string) => {
    if (!config.key) return;
    const body = {
      api_key: config.key,
      event,
      distinct_id: distinctId ?? `service:${config.service}`,
      properties: { ...properties, service: config.service, environment: config.environment ?? "dev", $process_person_profile: Boolean(distinctId) },
      timestamp: new Date().toISOString(),
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      await doFetch(`${host}/i/v0/e/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
    } catch {
      // Telemetry must never break the thing it watches.
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    captureException: (error, context = {}) => send("$exception", { ...exceptionProperties(error), ...cleanContext(context) }),
    capture: (event, properties = {}, distinctId) => send(event, cleanContext(properties), distinctId),
  };
}

function cleanContext(context: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(context)) out[k] = typeof v === "string" ? scrub(v) : v;
  return out;
}

// One reporter per process for code that can't take it as a parameter (deep in request
// handling). Functions call flushReports() before answering, so reports aren't cut off.
let reporter: Telemetry | null = null;
const pending = new Set<Promise<void>>();

export function setErrorReporter(telemetry: Telemetry | null) {
  reporter = telemetry;
}

export function reportError(error: unknown, context: Record<string, unknown> = {}) {
  console.error(context.area ?? "error", error);
  if (!reporter) return;
  const sent = reporter.captureException(error, context).finally(() => pending.delete(sent));
  pending.add(sent);
}

export async function flushReports() {
  await Promise.allSettled([...pending]);
}

// For a function's entry point: turn on reporting from its secrets, and make each request
// wait for its error reports before answering.
export function withReporting(service: string, env: (name: string) => string | undefined, handler: (request: Request) => Promise<Response>) {
  setErrorReporter(createTelemetry({ key: env("POSTHOG_KEY"), host: env("POSTHOG_HOST"), service, environment: env("APP_ENV") ?? "dev" }));
  return async (request: Request) => {
    try {
      return await handler(request);
    } catch (error) {
      reportError(error, { area: `${service} function` });
      return new Response(JSON.stringify({ error: "Something went wrong on our side. Try again in a moment." }), { status: 500, headers: { "Content-Type": "application/json" } });
    } finally {
      await flushReports();
    }
  };
}

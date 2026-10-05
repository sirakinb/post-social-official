import { describe, expect, it, vi } from "vitest";
import { createTelemetry, flushReports, parseStack, reportError, scrub, setErrorReporter, withReporting } from "./telemetry";

describe("scrub", () => {
  it("removes tokens and keys from messages", () => {
    const text = scrub("GET https://graph.facebook.com/v21.0/me?access_token=EAAB123secret&fields=id failed; Authorization: Bearer abc.def; key ps_live_abc123 phx_ZZZ");
    expect(text).not.toMatch(/EAAB123secret|abc\.def|ps_live_abc123|phx_ZZZ/);
    expect(text).toContain("access_token=[redacted]");
    expect(text).toContain("Bearer [redacted]");
  });
});

describe("parseStack", () => {
  it("reads Node and Deno frames, innermost last, marking our own code", () => {
    const stack = ["Error: boom", "    at publish (/app/worker.mjs:10:5)", "    at async run (file:///app/node_modules/x/index.js:2:3)", "    at /app/worker.mjs:20:1"].join("\n");
    const frames = parseStack(stack);
    expect(frames.map((f) => f.function)).toEqual(["<anonymous>", "async run", "publish"]);
    expect(frames.find((f) => f.function === "publish")).toMatchObject({ filename: "/app/worker.mjs", lineno: 10, colno: 5, in_app: true });
    expect(frames.find((f) => f.function === "async run")?.in_app).toBe(false);
  });
});

describe("createTelemetry", () => {
  it("sends an exception with service, environment and scrubbed context", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok"));
    const t = createTelemetry({ key: "phc_test", service: "worker", environment: "prod", fetchImpl: fetchImpl as unknown as typeof fetch });
    await t.captureException(new Error("token=abc failed"), { job: "publish", url: "https://x?access_token=zzz" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://us.i.posthog.com/i/v0/e/");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ api_key: "phc_test", event: "$exception", distinct_id: "service:worker" });
    expect(body.properties).toMatchObject({ service: "worker", environment: "prod", job: "publish", $process_person_profile: false });
    expect(body.properties.$exception_list[0].value).toBe("token=[redacted] failed");
    expect(body.properties.url).not.toContain("zzz");
  });

  it("does nothing without a key and never throws", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    });
    await createTelemetry({ service: "api", fetchImpl: fetchImpl as unknown as typeof fetch }).captureException(new Error("x"));
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(createTelemetry({ key: "phc_test", service: "api", fetchImpl: fetchImpl as unknown as typeof fetch }).capture("post_published")).resolves.toBeUndefined();
  });
});

describe("function reporting", () => {
  it("reports unexpected errors and waits for them before answering", async () => {
    const sent: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      await new Promise((r) => setTimeout(r, 20));
      sent.push(JSON.parse(String(init.body)).properties.area);
      return new Response("ok");
    });
    vi.stubGlobal("fetch", fetchImpl);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const env = (name: string) => ({ POSTHOG_KEY: "phc_test", APP_ENV: "prod" })[name];
    const handler = withReporting("api", env, async (request) => {
      if (request.url.endsWith("/boom")) throw new Error("boom");
      reportError(new Error("handled but unexpected"), { area: "api" });
      return new Response("fine");
    });
    expect(await (await handler(new Request("https://fn/ok"))).text()).toBe("fine");
    expect(sent).toEqual(["api"]); // already delivered when the response came back
    const crashed = await handler(new Request("https://fn/boom"));
    expect(crashed.status).toBe(500);
    expect(sent).toEqual(["api", "api function"]);
    setErrorReporter(null);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("is quiet without a reporter", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    setErrorReporter(null);
    reportError(new Error("x"));
    await expect(flushReports()).resolves.toBeUndefined();
    vi.restoreAllMocks();
  });
});

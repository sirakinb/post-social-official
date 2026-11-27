// The function AWS runs every minute (lambda/uptime/index.mjs): what counts as up, and what
// it writes for CloudWatch to turn into a number.
import { describe, expect, it } from "vitest";
import { metricLine, problemWith, runChecks } from "../lambda/uptime/index.mjs";

const answer = (status: number, body = "") => async () => new Response(body, { status });
const worker = { name: "worker", url: "https://api.example/readyz/worker", mustContain: '"ok":true' };

describe("one address", () => {
  it("is up when it answers 200, with the words we look for when we look for any", async () => {
    expect(await problemWith({ name: "website", url: "https://example/" }, answer(200, "<html>"))).toBeNull();
    expect(await problemWith(worker, answer(200, '{"ok":true,"seconds":12}'))).toBeNull();
  });

  it("is down when it answers with an error, and says which", async () => {
    expect(await problemWith(worker, answer(503, '{"ok":false,"seconds":900}'))).toBe("answered 503");
    expect(await problemWith({ name: "website", url: "https://example/" }, answer(404))).toBe("answered 404");
  });

  it("is down when it answers 200 without the words we look for", async () => {
    expect(await problemWith(worker, answer(200, "<html>a login page</html>"))).toBe('answered 200 without "ok":true');
  });

  it("is down when nothing answers in time or the connection fails", async () => {
    const slow = async () => { throw Object.assign(new Error("timed out"), { name: "TimeoutError" }); };
    const refused = async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }); };
    expect(await problemWith(worker, slow)).toBe("no answer in 10 seconds");
    expect(await problemWith(worker, refused)).toBe("could not connect (ECONNREFUSED)");
  });

  it("puts a time limit on every request", async () => {
    let signal: AbortSignal | null | undefined;
    await problemWith(worker, async (_input: string | URL | Request, init?: RequestInit) => { signal = init?.signal; return new Response('{"ok":true}'); });
    expect(signal).toBeInstanceOf(AbortSignal);
  });
});

describe("what it records", () => {
  it("is a number CloudWatch can read: 1 up, 0 down, named by environment and check", () => {
    const up = metricLine({ environment: "prod", name: "website", problem: null, now: 1_000 });
    expect(up).toEqual({
      _aws: { Timestamp: 1_000, CloudWatchMetrics: [{ Namespace: "PostSocial/Uptime", Dimensions: [["Environment", "Check"]], Metrics: [{ Name: "Up", Unit: "Count" }] }] },
      Environment: "prod",
      Check: "website",
      Up: 1,
    });
    expect(metricLine({ environment: "prod", name: "worker", problem: "answered 503", now: 1_000 })).toMatchObject({ Check: "worker", Up: 0, problem: "answered 503" });
  });

  it("writes one line per check, and one failing check doesn't hide the others", async () => {
    const lines: Record<string, unknown>[] = [];
    const fetchFn = async (input: string | URL | Request) => (String(input).includes("worker") ? new Response('{"ok":false}', { status: 503 }) : new Response("fine"));
    const result = await runChecks({ checks: [{ name: "website", url: "https://example/" }, worker], environment: "prod", fetchFn, write: (line: Record<string, unknown>) => lines.push(line), now: 5 });
    expect(result).toEqual({ website: "up", worker: "answered 503" });
    expect(lines.map((line) => [line.Check, line.Up])).toEqual([["website", 1], ["worker", 0]]);
  });
});

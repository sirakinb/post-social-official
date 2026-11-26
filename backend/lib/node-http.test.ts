// @vitest-environment node
import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nodeListener, type Handler, type ListenerOptions } from "./node-http";

let server: Server | null = null;
afterEach(() => new Promise<void>((resolve) => { if (!server) return resolve(); server.close(() => resolve()); server.closeAllConnections(); server = null; }));

async function serve(handler: Handler, options: ListenerOptions = {}) {
  server = createServer(nodeListener(handler, options));
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("nodeListener", () => {
  it("hands the handler a standard request and writes its response back", async () => {
    const seen: { url?: string; method?: string; auth?: string | null; body?: string } = {};
    const base = await serve(async (request) => {
      Object.assign(seen, { url: request.url, method: request.method, auth: request.headers.get("authorization"), body: await request.text() });
      return new Response(JSON.stringify({ ok: true }), { status: 201, headers: { "Content-Type": "application/json", "X-Extra": "yes" } });
    });
    const response = await fetch(`${base}/api/v1/posts?limit=2`, { method: "POST", headers: { Authorization: "Bearer ps_test_x" }, body: '{"a":1}' });
    expect(response.status).toBe(201);
    expect(response.headers.get("x-extra")).toBe("yes");
    expect(await response.json()).toEqual({ ok: true });
    expect(seen).toEqual({ url: `${base}/api/v1/posts?limit=2`, method: "POST", auth: "Bearer ps_test_x", body: '{"a":1}' });
  });

  it("uses https in the address when the load balancer says the caller did", async () => {
    let url = "";
    const base = await serve(async (request) => { url = request.url; return new Response("ok"); });
    await fetch(`${base}/x`, { headers: { "X-Forwarded-Proto": "https" } });
    expect(url).toMatch(/^https:\/\/127\.0\.0\.1:\d+\/x$/);
  });

  it("refuses a body over the limit without calling the handler, declared or not", async () => {
    const handler = vi.fn(async () => new Response("ok"));
    const base = await serve(handler, { maxBodyBytes: 100 });
    expect((await fetch(`${base}/x`, { method: "POST", body: "y".repeat(101) })).status).toBe(413);
    // No Content-Length: sent in chunks, counted as it arrives.
    const chunked = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(`${base}/x`, { method: "POST" }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
      req.on("error", reject);
      req.write("y".repeat(60));
      req.write("y".repeat(60));
      req.end();
    });
    expect(chunked).toBe(413);
    expect(handler).not.toHaveBeenCalled();
    expect((await fetch(`${base}/x`, { method: "POST", body: "y".repeat(100) })).status).toBe(200);
  });

  it("sends every Set-Cookie header separately and streams the body", async () => {
    const base = await serve(async () => {
      const headers = new Headers();
      headers.append("Set-Cookie", "a=1; Path=/");
      headers.append("Set-Cookie", "b=2; Path=/");
      const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode("one,")); controller.enqueue(new TextEncoder().encode("two")); controller.close(); } });
      return new Response(body, { headers });
    });
    const response = await fetch(`${base}/x`);
    expect(response.headers.getSetCookie()).toEqual(["a=1; Path=/", "b=2; Path=/"]);
    expect(await response.text()).toBe("one,two");
  });

  it("answers a plain 500 and reports the error when the handler throws", async () => {
    const onError = vi.fn();
    const base = await serve(async () => { throw new Error("boom with secret detail"); }, { onError });
    const response = await fetch(`${base}/x`);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toMatch(/boom/);
    expect(onError).toHaveBeenCalledOnce();
  });

  it("logs the path without the query string", async () => {
    const log = vi.fn();
    const base = await serve(async () => new Response(null, { status: 302, headers: { Location: "/" } }), { log });
    await fetch(`${base}/connections/oauth/x/callback?code=SECRET&state=s`, { redirect: "manual" });
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: "/connections/oauth/x/callback", status: 302 }));
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/SECRET/);
  });

  it("refuses a request whose Host header isn't a host name", async () => {
    const base = await serve(async () => new Response("ok"));
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(`${base}/x`, { headers: { Host: "evil.example/@internal" } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(400);
  });
});

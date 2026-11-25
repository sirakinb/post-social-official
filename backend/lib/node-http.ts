// Runs our request handlers on Node's HTTP server. The handlers speak the web standard
// (Request in, Response out), as they did as InsForge functions; this turns Node's request
// into a Request and writes the Response back. Node only.
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";

export type Handler = (request: Request) => Promise<Response>;

export type ListenerOptions = {
  // Largest request body accepted. Our endpoints take small JSON; media goes straight to storage.
  maxBodyBytes?: number;
  // One line per request. Only the path is passed, never the query string (sign-in codes).
  log?: (entry: { method: string; path: string; status: number; ms: number }) => void;
  onError?: (error: unknown) => void;
};

export const DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024;

class TooLarge extends Error {}

function send(res: ServerResponse, status: number, message: string) {
  if (res.headersSent) return res.destroy();
  const body = JSON.stringify({ error: message });
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store", Connection: "close" });
  res.end(body);
}

// Reads the whole body, stopping as soon as it is over the limit.
async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > limit) throw new TooLarge();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new TooLarge();
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

// The address the caller used. The load balancer ends HTTPS and says so in X-Forwarded-Proto.
function requestUrl(req: IncomingMessage): URL | null {
  const host = req.headers.host ?? "localhost";
  if (!/^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(host)) return null;
  const forwarded = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim();
  const protocol = forwarded === "https" ? "https" : "http";
  const target = req.url ?? "/";
  if (!target.startsWith("/")) return null; // absolute-form targets are for proxies, which this isn't
  try {
    return new URL(`${protocol}://${host}${target}`);
  } catch {
    return null;
  }
}

function requestHeaders(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (let i = 0; i + 1 < req.rawHeaders.length; i += 2) {
    try {
      headers.append(req.rawHeaders[i], req.rawHeaders[i + 1]);
    } catch {
      // A header the standard doesn't allow: leave it out rather than fail the request.
    }
  }
  return headers;
}

async function write(res: ServerResponse, response: Response, method: string) {
  const headers: Record<string, string | string[]> = {};
  response.headers.forEach((value, name) => {
    if (name !== "set-cookie") headers[name] = value;
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) headers["set-cookie"] = cookies;
  res.writeHead(response.status, headers);
  if (!response.body || method === "HEAD") return void res.end();
  await new Promise<void>((resolve, reject) => {
    const body = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream<Uint8Array>);
    body.on("error", reject);
    res.on("error", reject);
    res.on("close", resolve);
    body.pipe(res);
  });
}

export function nodeListener(handler: Handler, options: ListenerOptions = {}) {
  const limit = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  return async (req: IncomingMessage, res: ServerResponse) => {
    const started = Date.now();
    const method = (req.method ?? "GET").toUpperCase();
    const url = requestUrl(req);
    const done = (status: number) => options.log?.({ method, path: url?.pathname ?? "?", status, ms: Date.now() - started });
    if (!url) {
      send(res, 400, "Bad request.");
      return done(400);
    }
    try {
      const hasBody = method !== "GET" && method !== "HEAD";
      const body = hasBody ? await readBody(req, limit) : null;
      // Lets a handler stop work when the caller has gone away.
      const gone = new AbortController();
      res.on("close", () => { if (!res.writableFinished) gone.abort(); });
      const request = new Request(url, { method, headers: requestHeaders(req), body: body && body.length ? new Uint8Array(body) : undefined, signal: gone.signal });
      const response = await handler(request);
      await write(res, response, method);
      done(response.status);
    } catch (error) {
      if (error instanceof TooLarge) {
        send(res, 413, "The request is too large.");
        return done(413);
      }
      options.onError?.(error);
      send(res, 500, "Something went wrong on our side. Try again in a moment.");
      done(500);
    }
  };
}

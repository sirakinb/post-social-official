// The whole backend as one request handler, for the Node service on AWS. It mounts the four
// handlers that run as separate InsForge functions today, each under its function's name, and
// takes that name off the path before calling it, as InsForge did:
//
//   /api/...           REST API, MCP server, OAuth for AI apps, Stripe webhook, tracked links
//   /connections/...   connecting accounts, platform callbacks, Meta's calls
//   /media             media actions (also at /functions/media, the path the web app uses today)
//   /posts             post actions (also at /functions/posts)
//   /auth/...          sign-in (backend/lib/auth), for our website's server only
//   /healthz           the service is up (the load balancer's check; doesn't touch the database)
//   /readyz            the service can reach the database (checked after a deploy)
//   /readyz/worker     the worker has shown a sign of life lately (the uptime check)
//
// Runtime-neutral, so it is tested without a server. backend/server.ts puts it on a port.
import { reportError } from "./lib/telemetry";
import type { Env } from "./lib/settings";
import type { Handler } from "./lib/node-http";
import { fromOurWebsite } from "./lib/rate-limit";
import { workerStatus } from "./lib/worker-heartbeat";
import { apiDeps, type BackendBase } from "./functions/api/deps";
import { createApiHandler } from "./functions/api/handler";
import { connectionsDeps } from "./functions/connections/deps";
import { createConnectionsHandler } from "./functions/connections/handler";
import { mediaDeps } from "./functions/media/deps";
import { createMediaHandler } from "./functions/media/handler";
import { postsDeps } from "./functions/posts/deps";
import { createPostsHandler } from "./functions/posts/handler";

export type ServiceDeps = {
  env: Env;
  base: BackendBase;
  // True when the database answers. Used by /readyz only.
  ready: () => Promise<boolean>;
  // Seconds since the worker's last heartbeat, null if there has never been one. Used by
  // /readyz/worker only.
  workerSilence: () => Promise<number | null>;
  // Our own sign-in and the path it answers under. Left out while sign-in is elsewhere.
  auth?: { path: string; handler: Handler };
};

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

// An error a handler didn't deal with: report it, and tell the caller nothing about it.
function guarded(name: string, handler: Handler): Handler {
  return async (request) => {
    try {
      return await handler(request);
    } catch (error) {
      reportError(error, { area: `${name} function` });
      return json(500, { error: "Something went wrong on our side. Try again in a moment." });
    }
  };
}

export function createService(deps: ServiceDeps): Handler {
  const { env, base } = deps;
  const auth = deps.auth ? { path: deps.auth.path, handler: guarded("auth", deps.auth.handler) } : null;
  const proxySecret = env("INTERNAL_PROXY_SECRET") ?? null;
  const media = guarded("media", createMediaHandler(mediaDeps(env, base)));
  const posts = guarded("posts", createPostsHandler(postsDeps(env, base)));
  const mounts: Array<[string, Handler]> = [
    ["/api", guarded("api", createApiHandler(apiDeps(env, base)))],
    ["/connections", guarded("connections", createConnectionsHandler(connectionsDeps(env, base)))],
    ["/media", media],
    ["/functions/media", media],
    ["/posts", posts],
    ["/functions/posts", posts],
  ];

  return async (request) => {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/healthz") return json(200, { ok: true });
    if (path === "/readyz") {
      const ok = await deps.ready().catch(() => false);
      return json(ok ? 200 : 503, { ok });
    }
    // The worker has no address of its own, so the uptime check asks here. A database that
    // doesn't answer counts as a worker that is down: it can't work without one.
    if (path === "/readyz/worker") {
      const status = workerStatus(await deps.workerSilence().catch(() => null));
      return json(status.ok ? 200 : 503, status);
    }
    // Sign-in is called by our website's server, never by a browser or anyone else: without
    // the website's shared secret these routes don't exist. The website checks the attempt
    // limits before each call.
    if (auth && path.startsWith(`${auth.path}/`)) {
      if (!fromOurWebsite(request, proxySecret)) return json(404, { error: "Not found." });
      return auth.handler(request);
    }
    for (const [prefix, handler] of mounts) {
      if (path !== prefix && !path.startsWith(`${prefix}/`)) continue;
      url.pathname = path.slice(prefix.length) || "/";
      const init = { method: request.method, headers: request.headers, body: request.body, signal: request.signal, duplex: "half" };
      return handler(new Request(url, init as RequestInit));
    }
    return json(404, { error: "Not found." });
  };
}

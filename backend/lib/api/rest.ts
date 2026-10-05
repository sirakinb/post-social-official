// REST API v1, generated from the operations list. Errors always look like
// { error: { code, message } }. Writes accept an Idempotency-Key header: repeating a request
// with the same key within 24 hours returns the first result instead of acting twice.
import { ApiError, type AgentCaller } from "../access";
import { sha256Hex } from "../connections/crypto";
import { operations, type ApiDeps, type Operation } from "./operations";

const CODES: Record<number, string> = {
  400: "invalid_request",
  401: "unauthorized",
  402: "plan_limit",
  403: "forbidden",
  404: "not_found",
  405: "method_not_allowed",
  409: "conflict",
  413: "too_large",
  422: "idempotency_mismatch",
  500: "internal_error",
};

export function errorBody(status: number, message: string) {
  return { error: { code: CODES[status] ?? "error", message } };
}

// Turns a thrown error into a status and plain message. Database rules come back as
// plain sentences; anything unexpected is logged and hidden.
export function describeError(error: unknown): { status: number; message: string } {
  if (error instanceof ApiError) return { status: error.status, message: error.message };
  const message = error instanceof Error ? error.message : String(error);
  const rule = message.match(/Invalid post transition: \w+ -> \w+|Only approved posts can be queued[^"]*/)?.[0];
  if (rule) return { status: 409, message: rule };
  console.error("api error", error);
  return { status: 500, message: "Something went wrong on our side. Try again in a moment." };
}

export function matchRoute(method: string, pathname: string): { operation: Operation; params: Record<string, string> } | { allowed: string[] } | null {
  const parts = pathname.split("/").filter(Boolean);
  const allowed: string[] = [];
  for (const operation of operations) {
    const pattern = operation.path.split("/").filter(Boolean);
    if (pattern.length !== parts.length) continue;
    const params: Record<string, string> = {};
    const ok = pattern.every((segment, i) => {
      const name = segment.match(/^\{(\w+)\}$/)?.[1];
      if (name) {
        params[name] = decodeURIComponent(parts[i]);
        return true;
      }
      return segment === parts[i];
    });
    if (!ok) continue;
    if (operation.method === method) return { operation, params };
    allowed.push(operation.method);
  }
  return allowed.length ? { allowed } : null;
}

// Query strings are text; convert values to the types the operation declares.
export function queryInput(operation: Operation, search: URLSearchParams) {
  const input: Record<string, unknown> = {};
  for (const [key, raw] of search) {
    const type = (operation.input.properties[key] as { type?: string } | undefined)?.type;
    if (type === "integer") input[key] = /^-?\d+$/.test(raw) ? Number(raw) : raw;
    else if (type === "boolean") input[key] = raw === "true" ? true : raw === "false" ? false : raw;
    else input[key] = raw;
  }
  return input;
}

const MAX_BODY = 256 * 1024;

export async function bodyInput(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > MAX_BODY) throw new ApiError(413, "The request body is too large. Upload media with start_media_upload instead.");
  if (!text.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ApiError(400, "The body is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new ApiError(400, "The body must be a JSON object.");
  return parsed as Record<string, unknown>;
}

type Stored = { request_hash: string; status_code: number | null; response: unknown; fresh: boolean };

// Runs a write once per Idempotency-Key. Returns the status and body to send.
async function once(deps: ApiDeps, caller: AgentCaller, idempotencyKey: string, requestHash: string, run: () => Promise<{ status: number; body: unknown }>) {
  if (idempotencyKey.length > 255) throw new ApiError(400, "Idempotency-Key can be at most 255 characters.");
  // Forget keys older than a day, and runs that died without finishing (so they can retry).
  await deps.sql(
    `DELETE FROM public.api_idempotency WHERE actor_id = $1
       AND (created_at < now() - interval '24 hours' OR (status_code IS NULL AND created_at < now() - interval '2 minutes'))`,
    [caller.actorId],
  );
  const [row] = await deps.sql<Stored>(
    `WITH ins AS (
       INSERT INTO public.api_idempotency (actor_id, workspace_id, idempotency_key, request_hash)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (actor_id, idempotency_key) DO NOTHING
       RETURNING request_hash, status_code, response, true AS fresh
     )
     SELECT * FROM ins
     UNION ALL
     SELECT request_hash, status_code, response, false FROM public.api_idempotency
     WHERE actor_id = $1 AND idempotency_key = $3 AND NOT EXISTS (SELECT 1 FROM ins)`,
    [caller.actorId, caller.workspaceId, idempotencyKey, requestHash],
  );
  if (!row.fresh) {
    if (row.request_hash !== requestHash) throw new ApiError(422, "This Idempotency-Key was already used for a different request.");
    if (row.status_code === null) throw new ApiError(409, "A request with this Idempotency-Key is still running. Try again in a moment.");
    return { status: row.status_code, body: row.response, replayed: true };
  }
  const result = await run();
  if (result.status >= 500) {
    // Failures on our side may be retried with the same key.
    await deps.sql(`DELETE FROM public.api_idempotency WHERE actor_id = $1 AND idempotency_key = $2`, [caller.actorId, idempotencyKey]);
  } else {
    await deps.sql(`UPDATE public.api_idempotency SET status_code = $3, response = $4::jsonb WHERE actor_id = $1 AND idempotency_key = $2`, [
      caller.actorId,
      idempotencyKey,
      result.status,
      JSON.stringify(result.body),
    ]);
  }
  return { ...result, replayed: false };
}

export async function handleRest(deps: ApiDeps, caller: AgentCaller, request: Request, pathname: string): Promise<{ status: number; body: unknown; headers?: Record<string, string> }> {
  const route = matchRoute(request.method, pathname);
  if (!route) return { status: 404, body: errorBody(404, "No such endpoint. See /v1/openapi.json.") };
  if ("allowed" in route) return { status: 405, body: errorBody(405, `Use ${route.allowed.join(" or ")}.`), headers: { Allow: route.allowed.join(", ") } };
  const { operation, params } = route;

  const execute = async (input: Record<string, unknown>) => {
    try {
      const body = await operation.run(deps, caller, input);
      return { status: operation.creates ? 201 : 200, body };
    } catch (error) {
      const { status, message } = describeError(error);
      return { status, body: errorBody(status, message) };
    }
  };

  try {
    if (operation.method === "GET") return await execute({ ...queryInput(operation, new URL(request.url).searchParams), ...params });
    const input = { ...(await bodyInput(request)), ...params };
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey) return await execute(input);
    const hash = await sha256Hex(`${operation.name}\n${JSON.stringify(input)}`);
    const result = await once(deps, caller, idempotencyKey, hash, () => execute(input));
    return { status: result.status, body: result.body, headers: result.replayed ? { "Idempotent-Replayed": "true" } : undefined };
  } catch (error) {
    const { status, message } = describeError(error);
    return { status, body: errorBody(status, message) };
  }
}

// Calls the Post Social API. The list of commands comes from the server's own API
// description, so the CLI always matches what the server can do.
import { bearerToken, type Credentials } from "./auth";

export type Operation = {
  operationId: string;
  summary: string;
  description: string;
  method: string;
  path: string;
  pathParams: string[];
  properties: Record<string, { type?: string; description?: string; enum?: unknown[] }>;
  required: string[];
};

type OpenApi = { paths: Record<string, Record<string, { operationId: string; summary: string; description: string; parameters?: Array<{ name: string; in: string; required?: boolean; schema?: Record<string, unknown> }>; requestBody?: { content: { "application/json": { schema: { properties?: Record<string, Record<string, unknown>>; required?: string[] } } } } }>> };

export async function loadOperations(baseUrl: string, http: typeof fetch = fetch): Promise<Operation[]> {
  const response = await http(`${baseUrl}/api/v1/openapi.json`).catch(() => null);
  if (!response?.ok) throw new Error(`Could not reach Post Social at ${baseUrl}. Check your connection (or --base-url).`);
  const doc = (await response.json()) as OpenApi;
  const ops: Operation[] = [];
  for (const [path, methods] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      const params = op.parameters ?? [];
      const body = op.requestBody?.content["application/json"].schema;
      const properties: Operation["properties"] = {};
      const required: string[] = [];
      for (const p of params.filter((p) => p.in === "path" || p.in === "query")) {
        properties[p.name] = (p.schema ?? {}) as Operation["properties"][string];
        if (p.required) required.push(p.name);
      }
      for (const [name, schema] of Object.entries(body?.properties ?? {})) properties[name] = schema as Operation["properties"][string];
      required.push(...(body?.required ?? []));
      ops.push({
        operationId: op.operationId,
        summary: op.summary,
        description: op.description,
        method: method.toUpperCase(),
        path,
        pathParams: params.filter((p) => p.in === "path").map((p) => p.name),
        properties,
        required,
      });
    }
  }
  return ops.sort((a, b) => a.operationId.localeCompare(b.operationId));
}

export class ApiFailure extends Error {
  constructor(public status: number, public body: unknown) {
    super(typeof body === "object" && body && "error" in body ? String((body as { error: { message?: string } }).error?.message ?? "Request failed") : `Request failed (${status})`);
  }
}

export async function callOperation(
  credentials: Credentials,
  op: Operation,
  input: Record<string, unknown>,
  options: { idempotencyKey?: string; http?: typeof fetch } = {},
): Promise<unknown> {
  const http = options.http ?? fetch;
  const missing = op.required.filter((name) => input[name] === undefined);
  if (missing.length) throw new ApiFailure(400, { error: { code: "invalid_request", message: `Missing ${missing.map((m) => `--${m.replace(/_/g, "-")}`).join(", ")}.` } });

  let path = op.path;
  const rest = { ...input };
  for (const name of op.pathParams) {
    path = path.replace(`{${name}}`, encodeURIComponent(String(rest[name])));
    delete rest[name];
  }
  const url = new URL(`${credentials.baseUrl}/api${path}`);
  const inQuery = op.method === "GET" || op.method === "DELETE";
  if (inQuery) for (const [k, v] of Object.entries(rest)) url.searchParams.set(k, typeof v === "string" ? v : JSON.stringify(v));

  const send = async (force: boolean) =>
    http(url, {
      method: op.method,
      headers: {
        Authorization: `Bearer ${await bearerToken(credentials, force)}`,
        "Content-Type": "application/json",
        ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
      },
      body: inQuery ? undefined : JSON.stringify(rest),
    });
  let response = await send(false);
  // A signed-in session may have just expired: renew once and retry.
  if (response.status === 401 && credentials.kind === "oauth") response = await send(true);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new ApiFailure(response.status, body);
  return body;
}

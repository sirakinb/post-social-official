// OpenAPI 3.1 description of the REST API, generated from the operations list.
import { operations } from "./operations";
import { SERVER_VERSION } from "./mcp";

const errorSchema = {
  type: "object",
  required: ["error"],
  properties: { error: { type: "object", required: ["code", "message"], properties: { code: { type: "string" }, message: { type: "string" } } } },
};

export function openApiDocument(serverUrl: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of operations) {
    const pathParams = [...op.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    const bodyProps = Object.fromEntries(Object.entries(op.input.properties).filter(([name]) => !pathParams.includes(name)));
    const required = (op.input.required ?? []).filter((name) => !pathParams.includes(name));
    const inQuery = op.method === "GET" || op.method === "DELETE";
    const parameters = [
      ...pathParams.map((name) => ({ name, in: "path", required: true, schema: op.input.properties[name] })),
      ...(inQuery ? Object.entries(bodyProps).map(([name, schema]) => ({ name, in: "query", required: required.includes(name), schema })) : []),
      ...(!inQuery ? [{ name: "Idempotency-Key", in: "header", required: false, schema: { type: "string", maxLength: 255 }, description: "Repeat-safe writes: the same key within 24 hours returns the first result." }] : []),
    ];
    paths[op.path] ??= {};
    paths[op.path][op.method.toLowerCase()] = {
      operationId: op.name,
      summary: op.title,
      description: op.description,
      parameters,
      ...(!inQuery && Object.keys(bodyProps).length
        ? { requestBody: { required: required.length > 0, content: { "application/json": { schema: { type: "object", properties: bodyProps, ...(required.length ? { required } : {}) } } } } }
        : {}),
      responses: {
        [op.creates ? "201" : "200"]: { description: "Success", content: { "application/json": { schema: { type: "object" } } } },
        default: { description: "Error", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Post Social API",
      version: SERVER_VERSION,
      description: "Publish and schedule posts to connected social accounts. Authenticate with an API key: Authorization: Bearer ps_live_... (test keys, ps_test_..., cannot publish).",
    },
    servers: [{ url: serverUrl }],
    security: [{ apiKey: [] }],
    components: { securitySchemes: { apiKey: { type: "http", scheme: "bearer" } }, schemas: { Error: errorSchema } },
    paths,
  };
}

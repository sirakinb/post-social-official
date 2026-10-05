// Remote MCP server (streamable HTTP, stateless). Each POST carries one JSON-RPC message and
// gets a JSON reply; there are no sessions or server-sent streams. Tools are generated from
// the operations list, so they match the REST API exactly.
import type { AgentCaller } from "../access";
import { operations, type ApiDeps, type Operation } from "./operations";
import { describeError } from "./rest";

export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
export const SERVER_VERSION = "1.0.0";

const INSTRUCTIONS = [
  "Post Social publishes to the person's connected social accounts (Instagram, Facebook Pages, Threads, YouTube Shorts, TikTok).",
  "Start with list_social_accounts to get account ids and limits. Media must be in Post Social first (import_media from a link), and ready, before it can be attached.",
  "Use validate_post to check a post, then create_post. Many accounts require the person's approval: the post waits in Post Social and next_step explains it. Never claim a post is live until list_post_results shows a live link.",
  "New accounts are connected by the person: give them the link from request_connect_link.",
].join(" ");

type Message = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

const rpcError = (id: Message["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const rpcResult = (id: Message["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });

export function toolDefinition(operation: Operation) {
  return {
    name: operation.name,
    title: operation.title,
    description: operation.description,
    inputSchema: { type: "object", properties: operation.input.properties, ...(operation.input.required?.length ? { required: operation.input.required } : {}) },
    annotations: {
      title: operation.title,
      readOnlyHint: Boolean(operation.readOnly),
      destructiveHint: Boolean(operation.destructive),
      // Every tool reaches a platform or the person's data outside this conversation.
      openWorldHint: true,
    },
  };
}

// Returns the reply body, or null for a notification (answered with 202 and no body).
export async function handleMcp(deps: ApiDeps, caller: AgentCaller, raw: unknown): Promise<unknown | null> {
  if (Array.isArray(raw)) return rpcError(null, -32600, "Batched requests are not supported. Send one message per request.");
  const message = (raw && typeof raw === "object" ? raw : {}) as Message;
  if (message.jsonrpc !== "2.0" || typeof message.method !== "string") return rpcError(message.id, -32600, "Not a JSON-RPC 2.0 request.");
  const isNotification = message.id === undefined;
  if (isNotification) return null;

  switch (message.method) {
    case "initialize": {
      const requested = String(message.params?.protocolVersion ?? "");
      return rpcResult(message.id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "post-social", title: "Post Social", version: SERVER_VERSION },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return rpcResult(message.id, {});
    case "tools/list":
      return rpcResult(message.id, { tools: operations.map(toolDefinition) });
    case "tools/call": {
      const name = String(message.params?.name ?? "");
      const operation = operations.find((o) => o.name === name);
      if (!operation) return rpcError(message.id, -32602, `Unknown tool: ${name}`);
      const args = message.params?.arguments;
      if (args !== undefined && (typeof args !== "object" || args === null || Array.isArray(args))) {
        return rpcError(message.id, -32602, "Tool arguments must be an object.");
      }
      try {
        const result = await operation.run(deps, caller, (args ?? {}) as Record<string, unknown>);
        const structured = result && typeof result === "object" && !Array.isArray(result) ? { structuredContent: result } : {};
        return rpcResult(message.id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], ...structured, isError: false });
      } catch (error) {
        // Tool failures go back to the AI as readable results it can act on.
        const { message: text } = describeError(error);
        return rpcResult(message.id, { content: [{ type: "text", text }], isError: true });
      }
    }
    default:
      return rpcError(message.id, -32601, `Method not supported: ${message.method}`);
  }
}

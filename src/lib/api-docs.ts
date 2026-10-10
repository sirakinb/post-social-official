// What the docs page and /llms.txt say about the API, built from the same operations list
// the REST API and MCP server use, so the docs always match the server.
import { availableOperations } from "../../backend/lib/api/operations";
import type { Platform } from "../../backend/lib/connections/platforms";

export const SITE = "https://www.postsocial.xyz";
export const MCP_URL = `${SITE}/mcp`;
export const API_URL = `${SITE}/api/v1`;

export function documentedOperations() {
  const analyticsPlatforms = (process.env.ANALYTICS_PLATFORMS ?? "").split(",").map((p) => p.trim()).filter(Boolean) as Platform[];
  return availableOperations({ analyticsPlatforms }).map((op) => ({
    name: op.name,
    title: op.title,
    description: op.description,
    method: op.method,
    path: `/api${op.path}`,
    cli: `postsocial ${op.name.replace(/_/g, "-")}`,
    destructive: Boolean(op.destructive),
    readOnly: Boolean(op.readOnly),
    options: Object.entries(op.input.properties).map(([name, schema]) => ({
      name,
      required: (op.input.required ?? []).includes(name),
      type: String((schema as { type?: string }).type ?? "string"),
      description: String((schema as { description?: string }).description ?? ""),
    })),
  }));
}

export function llmsText() {
  const ops = documentedOperations();
  return [
    "# Post Social",
    "",
    "> Post Social connects an AI to a person's social accounts (Instagram, Facebook Pages, Threads, YouTube Shorts, TikTok, LinkedIn, Bluesky, X) so the AI can publish, schedule and track posts as the person directs.",
    "",
    "## Connect",
    `- MCP server (streamable HTTP): ${MCP_URL}. Sign-in is OAuth 2.1 with dynamic client registration and PKCE (discovery at ${SITE}/.well-known/oauth-protected-resource/mcp), or send an API key: Authorization: Bearer ps_live_...`,
    `- REST API: ${API_URL}; OpenAPI 3.1 at ${API_URL}/openapi.json. Errors are {"error":{"code","message"}}; writes accept an Idempotency-Key header.`,
    "- CLI: npx postsocial login, then npx postsocial <command> (JSON in, JSON out). npx postsocial upload --file ./clip.mp4 uploads local media.",
    `- Docs for people: ${SITE}/docs`,
    "",
    "## How to post",
    "1. list_social_accounts for account ids and limits.",
    "2. Media must be in Post Social and ready: import_media from a public link (poll get_media), or upload with the CLI.",
    "3. validate_post, then create_post (now, or scheduled_at in ISO 8601; one call per post for a series).",
    "4. TikTok posts from an AI use delivery_mode inbox: the creator taps Post in TikTok.",
    "5. A post is live only when list_post_results shows published with a live_url.",
    "",
    "## Tools (MCP name = REST operationId; CLI command uses hyphens)",
    ...ops.map((op) => `- ${op.name} (${op.method} ${op.path}): ${op.description}`),
    "",
  ].join("\n");
}

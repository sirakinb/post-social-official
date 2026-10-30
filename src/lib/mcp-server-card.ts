import { MCP_URL, SITE } from "@/lib/api-docs";
import { PROTOCOL_VERSIONS, SERVER_VERSION } from "../../backend/lib/api/mcp";

// The MCP Server Card (SEP-1649, still a draft) at /.well-known/mcp/server-card.json: what the
// MCP server is, where to connect and how to sign in, before connecting. Name, version, protocol
// versions and capabilities are the ones the server itself reports on initialize.
export function mcpServerCard() {
  return {
    serverInfo: { name: "post-social", title: "Post Social", version: SERVER_VERSION },
    name: "xyz.postsocial/post-social",
    title: "Post Social",
    description: "Publish, schedule and track posts on TikTok, Instagram, Facebook Pages, Threads, YouTube, LinkedIn, Bluesky and X for the person who connected you.",
    version: SERVER_VERSION,
    websiteUrl: SITE,
    documentationUrl: `${SITE}/docs/connect`,
    endpoint: MCP_URL,
    transport: { type: "streamable-http", url: MCP_URL },
    remotes: [
      {
        type: "streamable-http",
        url: MCP_URL,
        supportedProtocolVersions: PROTOCOL_VERSIONS,
        authentication: { type: "oauth2", protectedResourceMetadata: `${SITE}/.well-known/oauth-protected-resource/mcp` },
      },
    ],
    capabilities: { tools: { listChanged: false } },
  };
}

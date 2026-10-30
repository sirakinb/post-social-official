import { mcpServerCard } from "@/lib/mcp-server-card";

// The MCP Server Card (src/lib/mcp-server-card.ts).
export function GET() {
  return Response.json(mcpServerCard(), { headers: { "Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*" } });
}

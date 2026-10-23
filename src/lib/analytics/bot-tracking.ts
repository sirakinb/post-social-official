import type { DataFastCrawlerTrackingConfig } from "@datafast/ai-crawl";
import { resolveAppEnv } from "@/components/environment-badge";

// DataFast's bot traffic tracking: from the server, it notes when AI assistants, search engines
// and model-training crawlers request our public pages (browser analytics can't see them,
// because crawlers skip JavaScript). Only requests it recognises as crawlers are sent, and
// only the page address, the crawler's user agent and its IP go with them.
//
// Not tracked: previews and staging, the signed-in app and AI approval screens (private pages),
// the API and MCP server, and any address with a query string, which can carry a token.
const PRIVATE_PREFIXES = ["/beta", "/oauth", "/mcp", "/tiktok-media"];

export function botTrackingConfig(appEnv = resolveAppEnv()): DataFastCrawlerTrackingConfig {
  return {
    websiteId: "dfid_ev0xid7Q3dcHOMtmozFCa",
    domain: "postsocial.xyz",
    enabled: appEnv === "production",
    additionalIgnoredPathPrefixes: PRIVATE_PREFIXES,
    shouldTrackPath: (url) => url.search === "" && !PRIVATE_PREFIXES.some((prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`)),
  };
}

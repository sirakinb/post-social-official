"use client";

import { useEffect } from "react";
import { PAGES, WEBMCP_TOOLS, docsSearchResults, priceEstimate, type PageName } from "@/lib/webmcp-tools";

// WebMCP: offers the site's own actions (src/lib/webmcp-tools.ts) to an AI agent using this
// page in a browser that supports it. The spec puts the API on document.modelContext; Chrome's
// early preview uses navigator.modelContext. Elsewhere this does nothing.
type ModelContext = {
  registerTool: (tool: Record<string, unknown>, options?: { signal?: AbortSignal }) => unknown;
};

const run: Record<string, (input: Record<string, unknown>) => unknown> = {
  search_docs: (input) => docsSearchResults(String(input.query ?? "")),
  estimate_monthly_price: (input) => priceEstimate(Number(input.accounts)),
  open_page: (input) => {
    const page = String(input.page) as PageName;
    if (!Object.hasOwn(PAGES, page)) return { error: `page must be one of: ${Object.keys(PAGES).join(", ")}` };
    window.location.assign(PAGES[page]);
    return { opened: PAGES[page] };
  },
};

export function WebMcpTools() {
  useEffect(() => {
    const modelContext = ((document as unknown as { modelContext?: ModelContext }).modelContext ??
      (navigator as unknown as { modelContext?: ModelContext }).modelContext) as ModelContext | undefined;
    if (!modelContext?.registerTool) return;
    const registration = new AbortController();
    for (const tool of WEBMCP_TOOLS) {
      try {
        void Promise.resolve(
          modelContext.registerTool({ ...tool, execute: async (input: Record<string, unknown> = {}) => run[tool.name](input ?? {}) }, { signal: registration.signal }),
        ).catch(() => {});
      } catch {
        // An older preview of the API; the page works the same without it.
      }
    }
    return () => registration.abort();
  }, []);
  return null;
}

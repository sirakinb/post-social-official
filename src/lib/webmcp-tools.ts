import { SITE } from "@/lib/site";
import { DOCS_PAGES, searchDocs } from "@/lib/docs-nav";
import { FREE_ACCOUNTS, monthlyBill, X_PRICES } from "@/lib/pricing";

// The site's own actions for AI agents browsing it (WebMCP, registered by
// src/components/webmcp-tools.tsx): search the docs, estimate a monthly price, open a page.
// Each returns plain JSON. None of them signs anyone in or changes anything.

export function docsSearchResults(query: string) {
  const words = String(query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  // Every word matching first; failing that, the pages matching the most words.
  let pages = searchDocs(String(query ?? ""));
  if (!pages.length && words.length) {
    pages = DOCS_PAGES.map((page) => {
      const text = `${page.title} ${page.description} ${page.keywords ?? ""}`.toLowerCase();
      return { page, hits: words.filter((w) => text.includes(w)).length };
    })
      .filter((r) => r.hits > 0)
      .sort((a, b) => b.hits - a.hits)
      .map((r) => r.page);
  }
  return { query, results: pages.slice(0, 5).map((p) => ({ title: p.title, description: p.description, url: `${SITE}${p.href}` })) };
}

export function priceEstimate(accounts: number) {
  const n = Math.max(0, Math.min(100000, Math.floor(Number(accounts) || 0)));
  const bill = monthlyBill(n);
  return {
    connected_accounts: n,
    monthly_total_usd: bill.total,
    free_accounts: FREE_ACCOUNTS,
    breakdown: [
      ...(n > 0 ? [{ accounts: Math.min(n, FREE_ACCOUNTS), usd_per_account: 0 }] : []),
      // The bill counts the free accounts as a credit against the first band; shown here as free.
      ...bill.bands
        .map((b, i) => ({ accounts: i === 0 ? Math.max(0, b.units - FREE_ACCOUNTS) : b.units, usd_per_account: b.perAccount }))
        .filter((b) => b.accounts > 0),
    ],
    notes: [
      `The first ${FREE_ACCOUNTS} connected accounts are free, with no card needed.`,
      "The 3rd account is charged when it is added; accounts added later are charged for the days left in the billing month.",
      `X posts are extra: $${X_PRICES.post} each, $${X_PRICES.postWithLink} with a link, after the first $${X_PRICES.freeMonthly} a month.`,
    ],
    details: `${SITE}/pricing`,
  };
}

export const PAGES = {
  sign_up: "/beta/signup",
  sign_in: "/beta/login",
  pricing: "/pricing",
  docs: "/docs",
  quickstart: "/docs/quickstart",
  connect_ai: "/docs/connect",
  affiliates: "/affiliates",
} as const;

export type PageName = keyof typeof PAGES;

export const WEBMCP_TOOLS = [
  {
    name: "search_docs",
    title: "Search the Post Social docs",
    description: "Search Post Social's documentation (connecting accounts and AI apps, posting, scheduling, billing, limits, troubleshooting). Returns up to 5 matching pages with links.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "What to look for, in plain words" } }, required: ["query"] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "estimate_monthly_price",
    title: "Estimate the monthly price",
    description: "Estimate what Post Social costs per month for a number of connected social accounts. The first 2 are free.",
    inputSchema: { type: "object", properties: { accounts: { type: "integer", minimum: 0, description: "Number of connected social accounts" } }, required: ["accounts"] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "open_page",
    title: "Open a Post Social page",
    description: "Open a page on this site in the current tab: sign_up, sign_in, pricing, docs, quickstart, connect_ai or affiliates.",
    inputSchema: { type: "object", properties: { page: { type: "string", enum: Object.keys(PAGES) } }, required: ["page"] },
    annotations: { readOnlyHint: false },
  },
] as const;

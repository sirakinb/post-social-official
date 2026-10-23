// The docs map: the sidebar, search and previous/next links all read this one list.
export type DocsPage = {
  title: string;
  href: string;
  description: string;
  keywords?: string; // extra words the search matches
  soon?: boolean; // a placeholder page with nothing verified yet
};

export type DocsGroup = { title: string; pages: DocsPage[] };

export const DOCS_NAV: DocsGroup[] = [
  {
    title: "Get started",
    pages: [
      { title: "Overview", href: "/docs", description: "What Post Social is and where to find things in the docs." },
      { title: "Quickstart", href: "/docs/quickstart", description: "Connect an account and an AI, send a first post and check that it went out.", keywords: "first post getting started tutorial live link" },
    ],
  },
  {
    title: "Concepts",
    pages: [
      { title: "Concepts", href: "/docs/concepts", description: "Workspaces, profiles, accounts, post states and API keys in plain language.", keywords: "workspace profile account draft scheduled published test live key status" },
    ],
  },
  {
    title: "Connect your AI",
    pages: [
      { title: "Connect an AI", href: "/docs/connect", description: "Set up Claude, ChatGPT, Claude Code, Cursor or another MCP app.", keywords: "mcp claude chatgpt claude code cursor connector oauth key" },
      { title: "Permissions and safety", href: "/docs/safety", description: "What an AI can do on its own and how to stay in control.", keywords: "approval approvals disconnect permissions" },
    ],
  },
  {
    title: "Platforms",
    pages: [
      { title: "Platforms", href: "/docs/platforms", description: "The eight platforms, what each can post and the limits Post Social checks.", keywords: "tiktok instagram facebook threads youtube linkedin bluesky x limits captions video" },
    ],
  },
  {
    title: "Guides and recipes",
    pages: [
      { title: "Recipes", href: "/docs/guides", description: "Ready-to-use prompts for common jobs.", keywords: "prompts schedule week cross-post", soon: true },
    ],
  },
  {
    title: "Troubleshooting",
    pages: [
      { title: "Troubleshooting", href: "/docs/troubleshooting", description: "Plain-language reasons posts and accounts fail, and how to fix each, with the API error codes.", keywords: "error errors reference failed reconnect needs attention 429 402 limit code" },
    ],
  },
  {
    title: "API and CLI reference",
    pages: [
      { title: "Command line", href: "/docs/cli", description: "Use Post Social from a terminal, script or agent without MCP.", keywords: "cli npx postsocial terminal" },
      { title: "REST API", href: "/docs/api", description: "Base address, authentication, errors and an example request.", keywords: "rest openapi curl idempotency bearer" },
      { title: "Tools", href: "/docs/tools", description: "Every action available over MCP, REST and the command line.", keywords: "operations endpoints mcp tools list create_post" },
      { title: "Rate limits and status", href: "/docs/limits", description: "Request limits and service status.", keywords: "rate limit 429 status uptime" },
    ],
  },
  {
    title: "Billing",
    pages: [
      { title: "Pricing and billing", href: "/docs/billing", description: "Free accounts, price per account, X posts and invoices.", keywords: "price cost free x cap invoice card cancel" },
    ],
  },
];

export const DOCS_PAGES: DocsPage[] = DOCS_NAV.flatMap((group) => group.pages);

export function docsNeighbours(pathname: string) {
  const path = pathname.replace(/\/$/, "") || "/docs";
  const index = DOCS_PAGES.findIndex((page) => page.href === path);
  if (index === -1) return { previous: undefined, next: undefined };
  return { previous: DOCS_PAGES[index - 1], next: DOCS_PAGES[index + 1] };
}

export function searchDocs(query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return DOCS_PAGES.filter((page) => {
    const text = `${page.title} ${page.description} ${page.keywords ?? ""}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

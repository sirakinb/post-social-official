import { DOCS_PAGES } from "@/lib/docs-nav";

// The public pages: listed in the sitemap, and served as Markdown to agents that ask for it
// (Accept: text/markdown). Docs pages come from the docs map, so a new docs page is included
// without another change.
// How the public pages may be used (contentsignals.org): in search results, as input to AI
// answers, and for AI training. Post Social wants to be found and quoted by AI, so all three
// are yes. Shown in robots.txt and on Markdown responses.
export const CONTENT_SIGNAL = "search=yes, ai-input=yes, ai-train=yes";

const PAGES = ["/", "/pricing", "/affiliates", "/changelog", "/privacy", "/terms", "/data-deletion"];

export const PUBLIC_PATHS: readonly string[] = [...new Set([...PAGES, ...DOCS_PAGES.map((page) => page.href)])];

const PUBLIC_SET = new Set(PUBLIC_PATHS);

// "/docs/quickstart/" and "/docs/quickstart" are the same page.
export function publicPath(pathname: string): string | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return PUBLIC_SET.has(path) ? path : null;
}

// Where a page's Markdown lives: /markdown for the home page, /markdown/docs/quickstart for a
// docs page. Agents can also fetch these addresses directly.
export const markdownPath = (path: string) => (path === "/" ? "/markdown" : `/markdown${path}`);

// True when the request prefers Markdown: text/markdown is listed (q > 0) and ranks at least as
// high as text/html. Browsers never send it, so they keep getting HTML.
export function wantsMarkdown(accept: string | null): boolean {
  if (!accept) return false;
  let markdown = 0;
  let html = 0;
  for (const part of accept.split(",")) {
    const [type, ...params] = part.trim().toLowerCase().split(";");
    const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    const weight = q ? Number(q.slice(2)) : 1;
    const value = Number.isFinite(weight) ? weight : 0;
    if (type.trim() === "text/markdown" || type.trim() === "text/x-markdown") markdown = Math.max(markdown, value);
    if (type.trim() === "text/html") html = Math.max(html, value);
  }
  return markdown > 0 && markdown >= html;
}

import type { MetadataRoute } from "next";
import { SITE } from "@/lib/api-docs";
import { DOCS_PAGES } from "@/lib/docs-nav";

// The public pages, for search engines and AI crawlers. Docs pages come from the docs map, so
// a new docs page is listed here without another change.
const PAGES = ["/", "/pricing", "/affiliates", "/changelog", "/privacy", "/terms", "/data-deletion"];

export default function sitemap(): MetadataRoute.Sitemap {
  const paths = [...PAGES, ...DOCS_PAGES.map((page) => page.href)];
  return [...new Set(paths)].map((path) => ({ url: path === "/" ? SITE : `${SITE}${path}` }));
}

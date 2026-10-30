import type { MetadataRoute } from "next";
import { SITE } from "@/lib/api-docs";
import { PUBLIC_PATHS } from "@/lib/public-pages";

// The public pages, for search engines and AI crawlers (src/lib/public-pages.ts).
export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PATHS.map((path) => ({ url: path === "/" ? SITE : `${SITE}${path}` }));
}

import type { MetadataRoute } from "next";
import { resolveAppEnv } from "@/components/environment-badge";
import { SITE } from "@/lib/api-docs";

// Crawlers may read the public site. The signed-in app and the AI approval screens are kept
// out (sign-in and sign-up stay open), and previews and staging ask not to be crawled at all.
export default function robots(): MetadataRoute.Robots {
  if (resolveAppEnv() !== "production") return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: { userAgent: "*", allow: ["/", "/beta/login", "/beta/signup"], disallow: ["/beta/", "/oauth/"] },
    sitemap: `${SITE}/sitemap.xml`,
  };
}

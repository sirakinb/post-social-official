import { resolveAppEnv } from "@/components/environment-badge";
import { SITE } from "@/lib/api-docs";
import { CONTENT_SIGNAL } from "@/lib/public-pages";

// Crawlers may read the public site. The signed-in app and the AI approval screens are kept
// out (sign-in and sign-up stay open), and previews and staging ask not to be crawled at all.
// Served by hand rather than from robots.ts, which has no way to add the Content-Signal line
// (contentsignals.org): how the public pages may be used by search and AI.
export function robotsText() {
  if (resolveAppEnv() !== "production") return ["User-Agent: *", "Disallow: /", ""].join("\n");
  return [
    "User-Agent: *",
    `Content-Signal: ${CONTENT_SIGNAL}`,
    "Allow: /",
    "Allow: /beta/login",
    "Allow: /beta/signup",
    "Disallow: /beta/",
    "Disallow: /oauth/",
    "",
    `Sitemap: ${SITE}/sitemap.xml`,
    "",
  ].join("\n");
}

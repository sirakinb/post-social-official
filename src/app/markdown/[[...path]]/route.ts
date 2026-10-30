import type { NextRequest } from "next/server";
import { pageMarkdown, tokenEstimate } from "@/lib/page-markdown";
import { CONTENT_SIGNAL, publicPath } from "@/lib/public-pages";

// A public page as Markdown, for agents. The proxy sends requests with Accept: text/markdown
// here (src/proxy.ts); /markdown/docs/quickstart can also be fetched directly. The page is
// rendered as usual and converted, so the Markdown always matches what browsers see.
export const revalidate = 3600;

export async function GET(request: NextRequest, { params }: { params: Promise<{ path?: string[] }> }) {
  const path = publicPath(`/${((await params).path ?? []).join("/")}`);
  if (!path) return new Response("Not found. Markdown is available for the public pages in /sitemap.xml.\n", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });

  const headers: Record<string, string> = { Accept: "text/html" };
  // Staging sits behind Vercel's protection; the deployment may read itself through it.
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypass) headers["x-vercel-protection-bypass"] = bypass;
  const page = await fetch(new URL(path, request.nextUrl.origin), { headers, next: { revalidate: 3600 } }).catch(() => null);
  if (!page?.ok) return new Response("This page could not be converted right now. Try again shortly.\n", { status: 502, headers: { "Content-Type": "text/plain; charset=utf-8" } });

  const markdown = pageMarkdown(await page.text(), path);
  return new Response(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      Vary: "Accept",
      "x-markdown-tokens": String(tokenEstimate(markdown)),
      "Content-Signal": CONTENT_SIGNAL,
    },
  });
}

import { llmsText } from "@/lib/api-docs";

// A plain-text summary of Post Social for AIs (llmstxt.org).
export function GET() {
  return new Response(llmsText(), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}

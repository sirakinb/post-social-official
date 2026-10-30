import { robotsText } from "@/lib/robots";

// robots.txt, from src/lib/robots.ts.
export function GET() {
  return new Response(robotsText(), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}

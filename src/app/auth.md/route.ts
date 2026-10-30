import { authMd } from "@/lib/auth-md";

// /auth.md, from src/lib/auth-md.ts.
export function GET() {
  return new Response(authMd(), { headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}

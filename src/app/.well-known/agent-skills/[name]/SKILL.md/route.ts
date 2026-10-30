import { SKILLS } from "@/lib/agent-skills";

// One skill's SKILL.md, exactly the text whose SHA-256 the index lists.
export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const skill = SKILLS.find((s) => s.name === name);
  if (!skill) return new Response("Not found.\n", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  return new Response(skill.text(), { headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}

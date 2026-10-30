import { skillsIndex } from "@/lib/agent-skills";

// The Agent Skills index (src/lib/agent-skills.ts).
export function GET() {
  return Response.json(skillsIndex(), { headers: { "Cache-Control": "public, max-age=3600" } });
}

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SKILLS, SKILLS_SCHEMA, skillsIndex } from "./agent-skills";
import { mcpServerCard } from "./mcp-server-card";

describe("agent skills index", () => {
  it("lists each skill with a lowercase name, a description, its address and the hash of its exact text", () => {
    const index = skillsIndex();
    expect(index.$schema).toBe(SKILLS_SCHEMA);
    expect(index.skills.map((s) => s.name)).toEqual(["connect-post-social", "publish-a-post"]);
    for (const [i, entry] of index.skills.entries()) {
      expect(entry.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(entry.type).toBe("skill-md");
      expect(entry.url).toBe(`/.well-known/agent-skills/${entry.name}/SKILL.md`);
      expect(entry.digest).toBe(`sha256:${createHash("sha256").update(SKILLS[i].text()).digest("hex")}`);
      expect(SKILLS[i].text()).toContain(`name: ${entry.name}`);
    }
  });
});

describe("MCP server card", () => {
  it("names the server, says where to connect and sign in, and lists its capabilities", () => {
    const card = mcpServerCard();
    expect(card.serverInfo).toMatchObject({ name: "post-social", version: "1.0.0" });
    expect(card.endpoint).toBe("https://www.postsocial.xyz/mcp");
    expect(card.capabilities).toEqual({ tools: { listChanged: false } });
    expect(card.remotes[0].authentication.protectedResourceMetadata).toBe("https://www.postsocial.xyz/.well-known/oauth-protected-resource/mcp");
  });
});

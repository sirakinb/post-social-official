import { describe, expect, it } from "vitest";
import { developerTools } from "./developerTools";

describe("developer MCP contract", () => {
  it("exposes the ten PRD tools exactly once", () => {
    const names = developerTools.map((tool) => tool.name);
    expect(names).toHaveLength(10);
    expect(new Set(names).size).toBe(10);
    expect(names).toEqual(["list_accounts", "upload_media", "create_post_draft", "preview_post", "schedule_post", "publish_post", "get_post", "list_posts", "get_post_results", "cancel_scheduled_post"]);
  });

  it("makes approval behavior explicit on publishing", () => {
    expect(developerTools.find((tool) => tool.name === "publish_post")?.description).toContain("approval policy");
  });

  it("publishes explicit platform destination contracts instead of a generic object", () => {
    const draft = developerTools.find((tool) => tool.name === "create_post_draft") as any;
    const variants = draft.inputSchema.properties.destinations.items.oneOf;
    expect(variants).toHaveLength(5);
    expect(variants.map((variant: any) => variant.properties.options.properties.kind.const)).toEqual(["tiktok", "instagram", "facebook", "threads", "youtube"]);
    const tiktokSnapshot = variants[0].properties.options.properties.creatorInfoSnapshot;
    expect(tiktokSnapshot.required).toEqual(expect.arrayContaining(["privacyLevelOptions", "commentAvailable", "duetAvailable", "stitchAvailable"]));
    expect(variants[3].properties.options.properties.text.maxLength).toBe(500);
    expect(variants[4].properties.options.properties.title.maxLength).toBe(100);
    expect(variants[4].properties.options.properties.privacyStatus.enum).toEqual(["public", "unlisted", "private"]);
  });
});

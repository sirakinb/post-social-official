import { describe, expect, it } from "vitest";
import { firstMedia, savedBy, type DraftRow } from "./drafts";

describe("savedBy", () => {
  it("names the person or app and where the draft came from", () => {
    expect(savedBy({ kind: "user", display_name: "Aki" }, "ui")).toBe("Saved by Aki");
    expect(savedBy({ kind: "oauth_grant", display_name: "Claude" }, "mcp")).toBe("Saved by Claude via MCP");
    expect(savedBy({ kind: "api_key", display_name: "Zapier key" }, "api")).toBe("Saved by Zapier key via the API");
  });

  it("still reads well when the actor is unknown", () => {
    expect(savedBy(null, "mcp")).toBe("Saved");
  });
});

describe("firstMedia", () => {
  const media = (id: string) => ({ id, media_type: "image" as const, status: "ready" });
  const row = (post_media: DraftRow["post_media"]): DraftRow => ({ id: "p", caption: "", updated_at: "", entry_point: "ui", actors: null, destinations: [], post_media });

  it("picks the first item by position, not by the order the rows came back", () => {
    expect(firstMedia(row([{ position: 2, media_assets: media("b") }, { position: 0, media_assets: media("a") }]))?.id).toBe("a");
  });

  it("is empty for a text-only draft", () => {
    expect(firstMedia(row([]))).toBeNull();
  });
});

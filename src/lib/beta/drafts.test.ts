import { describe, expect, it } from "vitest";
import { firstMedia, savedBy, type DraftRow } from "./drafts";
import { SAMPLE_DRAFT } from "../../../backend/lib/sample-draft";

describe("savedBy", () => {
  it("names the person or app and where the draft came from", () => {
    expect(savedBy({ kind: "user", display_name: "Aki" }, "ui")?.text).toBe("Saved by Aki");
    expect(savedBy({ kind: "oauth_grant", display_name: "Claude" }, "mcp")?.text).toBe("Saved by Claude via MCP");
    expect(savedBy({ kind: "api_key", display_name: "Zapier key" }, "api")?.text).toBe("Saved by Zapier key via the API");
  });

  it("credits the example draft to Post Social", () => {
    expect(savedBy({ kind: "user", display_name: "Rio" }, "ui", SAMPLE_DRAFT)?.text).toBe("Example from Post Social");
    expect(savedBy({ kind: "user", display_name: "Rio" }, "ui", "My own words")?.text).toBe("Saved by Rio");
  });

  it("uses the name an AI app gave when it connected, as the logs do", () => {
    expect(savedBy({ kind: "api_key", display_name: "Laptop key", client_name: "Claude Code" }, "mcp")).toEqual({ kind: "api_key", name: "Claude Code", text: "Saved by Claude Code via MCP" });
    // A person's own name always wins.
    expect(savedBy({ kind: "user", display_name: "Aki", client_name: "Claude Code" }, "ui")?.name).toBe("Aki");
  });

  it("is empty when the actor is unknown", () => {
    expect(savedBy(null, "mcp")).toBeNull();
  });
});

describe("firstMedia", () => {
  const media = (id: string) => ({ id, media_type: "image" as const, status: "ready" });
  const row = (post_media: DraftRow["post_media"]): DraftRow => ({ id: "p", caption: "", scheduled_at: null, updated_at: "", entry_point: "ui", actors: null, destinations: [], post_media });

  it("picks the first item by position, not by the order the rows came back", () => {
    expect(firstMedia(row([{ position: 2, media_assets: media("b") }, { position: 0, media_assets: media("a") }]))?.id).toBe("a");
  });

  it("is empty for a text-only draft", () => {
    expect(firstMedia(row([]))).toBeNull();
  });
});

import { describe, expect, it, vi } from "vitest";
import { areaOf, errorOf, levelOf, loadLogs, whoDid } from "./logs";

describe("logs", () => {
  it("sorts events into levels and areas", () => {
    expect(levelOf("destination.failed")).toBe("error");
    expect(levelOf("account.deauthorized")).toBe("warning");
    expect(levelOf("post.created")).toBe("info");
    expect(areaOf("destination.published")).toBe("posts");
    expect(areaOf("profile.created")).toBe("accounts");
    expect(areaOf("oauth_grant.revoked")).toBe("access");
    expect(areaOf("workspace.renamed")).toBeNull();
  });

  it("finds the reason a failure gave, wherever it was written", () => {
    expect(errorOf("destination.failed", { code: "rate_limited", message: "Instagram says slow down" }, null)).toEqual({ code: "rate_limited", message: "Instagram says slow down" });
    expect(errorOf("media.failed", { reason: "Video is longer than 3 minutes" }, null)).toEqual({ code: null, message: "Video is longer than 3 minutes" });
    expect(errorOf("account.refresh_failed", null, null)).toBeNull();
    expect(errorOf("post.created", { message: "not an error" }, null)).toBeNull();
  });
});

describe("whoDid", () => {
  const aki = { kind: "user" as const, display_name: "Aki" };
  const key = { kind: "api_key" as const, display_name: "Key A", client_name: "Claude Code" };

  it("credits publishing steps to whoever made the post", () => {
    expect(whoDid(null, aki)).toEqual({ actorKind: "user", actorName: "Aki", actorVia: null });
    expect(whoDid(null, key)).toEqual({ actorKind: "api_key", actorName: "Claude Code", actorVia: "Key A" });
  });

  it("shows the AI app's own name over the key's, and Post Social when no one is behind it", () => {
    expect(whoDid(key, aki).actorName).toBe("Claude Code");
    expect(whoDid({ kind: "oauth_grant", display_name: "Codex", client_name: "Codex" }, null)).toEqual({ actorKind: "oauth_grant", actorName: "Codex", actorVia: null });
    expect(whoDid({ kind: "api_key", display_name: "Key A", client_name: null }, null).actorName).toBe("Key A");
    expect(whoDid(null, null)).toEqual({ actorKind: "system", actorName: "Post Social", actorVia: null });
  });

  it("shows names saved before an app was known the way people know it", () => {
    expect(whoDid({ kind: "api_key", display_name: "Muse", client_name: "muse-custom-connector" }, null)).toEqual({ actorKind: "api_key", actorName: "Muse", actorVia: null });
    expect(whoDid({ kind: "oauth_grant", display_name: "Claude", client_name: "AnthropicClaudeAI" }, null)).toEqual({ actorKind: "oauth_grant", actorName: "Claude", actorVia: null });
  });
});

describe("loadLogs", () => {
  it("still loads when the database doesn't have app names yet", async () => {
    const selects: string[] = [];
    const event = { id: "e1", occurred_at: "2026-10-11T00:00:00Z", event_type: "post.created", entry_point: "mcp", entity_type: "post", entity_id: "p1", summary: "Created a draft", before_values: null, after_values: null, metadata: null, actors: { kind: "api_key", display_name: "Key A" } };
    const from = vi.fn(() => {
      const chain: Record<string, unknown> = {};
      for (const m of ["eq", "order", "limit", "in", "or", "lt"]) chain[m] = () => chain;
      chain.select = (columns: string) => {
        selects.push(columns);
        return chain;
      };
      chain.then = (resolve: (v: unknown) => void) =>
        resolve(selects.at(-1)!.includes("client_name") ? { data: null, error: { message: "column actors.client_name does not exist" } } : { data: [event], error: null });
      return chain;
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await loadLogs({ database: { from } } as never, "w", { level: "all", area: null, source: null, actorId: null, before: null });
    expect(result.failed).toBe(false);
    expect(result.logs[0]).toMatchObject({ actorKind: "api_key", actorName: "Key A" });
    expect(selects).toHaveLength(2);
  });
});

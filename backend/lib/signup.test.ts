import { describe, expect, it } from "vitest";
import type { Sql } from "./access";
import { provisionWorkspace, slugBase, workspaceNameFor } from "./signup";

describe("slugBase", () => {
  it("makes a short address from a name", () => {
    expect(slugBase("Ada Lovelace")).toBe("ada-lovelace");
    expect(slugBase("  José Ñúñez! ")).toBe("jose-nunez");
  });
  it("falls back when a name has no usable letters", () => {
    expect(slugBase("")).toBe("workspace");
    expect(slugBase("✨")).toBe("workspace");
    expect(slugBase("a")).toBe("workspace");
  });
  it("leaves room for the suffix", () => {
    expect(slugBase("x".repeat(100)).length).toBeLessThanOrEqual(40);
  });
});

describe("workspaceNameFor", () => {
  it("names the workspace after the person", () => {
    expect(workspaceNameFor("Ada")).toBe("Ada's workspace");
    expect(workspaceNameFor("   ")).toBe("My workspace");
  });
});

describe("provisionWorkspace", () => {
  const person = { userId: "11111111-1111-4111-8111-111111111111", displayName: "Ada", entryPoint: "ui" as const };

  it("asks the database for the person's workspace", async () => {
    const calls: unknown[][] = [];
    const sql = (async (_query: string, params: unknown[]) => {
      calls.push(params);
      return [{ workspace_id: "w1" }];
    }) as Sql;
    await expect(provisionWorkspace(sql, person, {}, () => "abc123")).resolves.toEqual({ workspace_id: "w1" });
    expect(calls[0]).toEqual([person.userId, "Ada's workspace", "ada-abc123", "Ada", "Workspace created at sign-up"]);
  });

  it("retries with a new address when one is taken", async () => {
    let n = 0;
    const sql = (async () => {
      if (n++ === 0) throw new Error('duplicate key value violates unique constraint "workspaces_slug_key"');
      return [{ workspace_id: "w2" }];
    }) as Sql;
    await expect(provisionWorkspace(sql, person, {}, () => String(n))).resolves.toEqual({ workspace_id: "w2" });
  });

  it("refuses API keys and signed-in apps", async () => {
    const sql = (async () => []) as Sql;
    const key = { kind: "key" as const, credentialId: "k", workspaceId: "w", actorId: "a", mode: "live" as const, displayName: "k", entryPoint: "api" as const };
    await expect(provisionWorkspace(sql, key)).rejects.toMatchObject({ status: 403 });
  });
});

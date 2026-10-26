import { describe, expect, it } from "vitest";
import type { Sql } from "./access";
import { flushReports, setErrorReporter } from "./telemetry";
import { SAMPLE_DRAFT, addSampleDraft, provisionWorkspace, slugBase, workspaceNameFor } from "./signup";

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

describe("addSampleDraft", () => {
  it("adds one example draft, only to a new workspace the person made, with no posts yet", async () => {
    const calls: Array<{ query: string; params: unknown[] }> = [];
    const sql = (async (query: string, params: unknown[]) => { calls.push({ query, params }); return []; }) as Sql;
    await addSampleDraft(sql, "w1", "u1");
    expect(calls).toHaveLength(1);
    expect(calls[0].params).toEqual(["w1", "u1", SAMPLE_DRAFT]);
    expect(calls[0].query).toContain("'draft'");
    expect(calls[0].query).toContain("w.created_by = $2");
    expect(calls[0].query).toContain("interval '10 minutes'");
    expect(calls[0].query).toContain("NOT EXISTS (SELECT 1 FROM public.posts");
  });

  it("never fails sign-up", async () => {
    const sql = (async () => { throw new Error("database down"); }) as Sql;
    await expect(addSampleDraft(sql, "w1", "u1")).resolves.toBeUndefined();
  });

  it("is added when a workspace is provisioned", async () => {
    const queries: string[] = [];
    const sql = (async (query: string) => { queries.push(query); return [{ workspace_id: "w1" }]; }) as Sql;
    await provisionWorkspace(sql, { userId: "11111111-1111-4111-8111-111111111111", displayName: "Ada", entryPoint: "ui" }, {}, () => "abc123");
    expect(queries[1]).toContain("INSERT INTO public.posts");
  });
});

describe("provisionWorkspace analytics", () => {
  const person = { userId: "11111111-1111-4111-8111-111111111111", displayName: "Ada", entryPoint: "ui" as const };

  it("records a signed_up event for the person, with the workspace so test accounts can be filtered out", async () => {
    const sent: Array<{ event: string; properties: Record<string, unknown>; distinctId?: string }> = [];
    setErrorReporter({ captureException: async () => undefined, capture: async (event, properties, distinctId) => void sent.push({ event, properties: properties ?? {}, distinctId }) });
    const sql = (async () => [{ workspace_id: "w1" }]) as Sql;
    await provisionWorkspace(sql, person, {}, () => "abc123");
    await flushReports();
    setErrorReporter(null);
    expect(sent).toEqual([{ event: "signed_up", properties: { workspace_id: "w1" }, distinctId: person.userId }]);
  });
});

import { describe, expect, it } from "vitest";
import { publishAttribution } from "./attribution";
import type { Sql } from "../../../backend/lib/access";

const returning = (rows: unknown[]): Sql => (async () => rows) as unknown as Sql;

describe("publishAttribution", () => {
  it("credits a post made in the app to the person", async () => {
    expect(await publishAttribution(returning([{ kind: "user", user_id: "u1", client_name: null }]), "d1")).toEqual({ userId: "u1", source: "app", aiApp: undefined });
  });

  it("credits an AI app's post to the person who connected it, with the app's name", async () => {
    expect(await publishAttribution(returning([{ kind: "oauth_grant", user_id: "u2", client_name: "claude-code" }]), "d1")).toEqual({ userId: "u2", source: "ai_app", aiApp: "claude-code" });
    expect(await publishAttribution(returning([{ kind: "api_key", user_id: "u3", client_name: "codex" }]), "d1")).toEqual({ userId: "u3", source: "api", aiApp: "codex" });
  });

  it("falls back to the name a connected app registered with, so older connections are named too", async () => {
    let query = "";
    const sql = (async (text: string) => {
      query = text;
      return [{ kind: "oauth_grant", user_id: "u4", client_name: "Claude" }];
    }) as unknown as Sql;
    expect(await publishAttribution(sql, "d1")).toEqual({ userId: "u4", source: "ai_app", aiApp: "Claude" });
    expect(query).toMatch(/coalesce\(a\.client_name, nullif\(c\.client_name, 'An AI app'\)\)/);
    expect(query).toMatch(/JOIN public\.oauth_clients c ON c\.id = g\.oauth_client_id/);
  });

  it("never throws, even when the lookup fails or finds nothing", async () => {
    expect(await publishAttribution(returning([]), "d1")).toEqual({ source: "unknown" });
    const failing = (async () => { throw new Error("db down"); }) as unknown as Sql;
    expect(await publishAttribution(failing, "d1")).toEqual({ source: "unknown" });
  });
});

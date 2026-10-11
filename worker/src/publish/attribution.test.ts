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

  it("never throws, even when the lookup fails or finds nothing", async () => {
    expect(await publishAttribution(returning([]), "d1")).toEqual({ source: "unknown" });
    const failing = (async () => { throw new Error("db down"); }) as unknown as Sql;
    expect(await publishAttribution(failing, "d1")).toEqual({ source: "unknown" });
  });
});

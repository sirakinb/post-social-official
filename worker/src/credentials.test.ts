// @vitest-environment node
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { accountToken } from "./credentials";
import { PublishError } from "./publish/types";

const key = randomBytes(32).toString("base64");
const setting = (name: string) => (name === "CREDENTIAL_ENCRYPTION_KEY" ? key : "");
const account = { id: "acc-1", platform: "linkedin" as const, displayName: "Studio" };

// A fake database: no saved login for the account; records every statement it is given.
function database() {
  const statements: { text: string; params: unknown[] }[] = [];
  const sql = (async (text: string, params: unknown[] = []) => {
    statements.push({ text, params });
    return [];
  }) as never;
  return { sql, statements };
}

describe("an account that has lost its saved login", () => {
  it("is flagged as needing a reconnect so the person sees the Reconnect prompt", async () => {
    const { sql, statements } = database();

    const error = await accountToken({ sql, setting }, account).catch((e) => e);

    expect(error).toBeInstanceOf(PublishError);
    expect(error.code).toBe("credential_missing");
    expect(error.reconnect).toBe(true);
    const flag = statements.find((s) => /UPDATE public\.connected_accounts SET health = 'needs_attention'/.test(s.text));
    expect(flag?.params[0]).toBe("acc-1");
    expect(flag?.text).toMatch(/health = 'connected'/);
  });
});

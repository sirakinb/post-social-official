import { describe, expect, it } from "vitest";
import { applySettingsJson } from "./settings-json";

describe("applySettingsJson", () => {
  it("spreads the JSON object into the environment and removes the blob", () => {
    const env: Record<string, string | undefined> = { SETTINGS_JSON: JSON.stringify({ STRIPE_SECRET_KEY: "sk", WORKER_CONCURRENCY: 3, NUDGE_EMAILS: true }) };
    expect(applySettingsJson(env).sort()).toEqual(["NUDGE_EMAILS", "STRIPE_SECRET_KEY", "WORKER_CONCURRENCY"]);
    expect(env).toEqual({ STRIPE_SECRET_KEY: "sk", WORKER_CONCURRENCY: "3", NUDGE_EMAILS: "true" });
  });

  it("never replaces what is set on the container itself", () => {
    const env: Record<string, string | undefined> = { API_BASE_URL: "https://api-dev.postsocial.xyz/api", SETTINGS_JSON: JSON.stringify({ API_BASE_URL: "https://old.example/api", OTHER: "x" }) };
    expect(applySettingsJson(env)).toEqual(["OTHER"]);
    expect(env.API_BASE_URL).toBe("https://api-dev.postsocial.xyz/api");
  });

  it("keeps a key pasted as JSON as one setting, and skips empty ones", () => {
    const env: Record<string, string | undefined> = { SETTINGS_JSON: JSON.stringify({ BLUESKY_CLIENT_JWK: { kty: "EC", crv: "P-256" }, UNUSED: null }) };
    applySettingsJson(env);
    expect(JSON.parse(env.BLUESKY_CLIENT_JWK!)).toEqual({ kty: "EC", crv: "P-256" });
    expect("UNUSED" in env).toBe(false);
  });

  it("does nothing without it, or with the empty object the secret starts as", () => {
    expect(applySettingsJson({})).toEqual([]);
    expect(applySettingsJson({ SETTINGS_JSON: "{}" })).toEqual([]);
    expect(applySettingsJson({ SETTINGS_JSON: "  " })).toEqual([]);
  });

  it("refuses anything that isn't one object of settings, without repeating a value", () => {
    for (const bad of ['{"A": "secret-value"', '["secret-value"]', '"secret-value"', '{"BAD NAME": "secret-value"}', '{"A=B": "secret-value"}']) {
      let message = "";
      try { applySettingsJson({ SETTINGS_JSON: bad }); } catch (error) { message = (error as Error).message; }
      expect(message).toMatch(/SETTINGS_JSON/);
      expect(message).not.toMatch(/secret-value/);
    }
  });
});

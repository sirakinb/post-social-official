// @vitest-environment node
import { describe, expect, it } from "vitest";
import { scramVerifier, setPasswordStatement } from "./scram";

describe("scramVerifier", () => {
  it("makes the form Postgres stores, and never contains the password", () => {
    const password = "correcthorsebatterystaple42";
    const verifier = scramVerifier(password, Buffer.from("0123456789abcdef"));
    expect(verifier).toMatch(/^SCRAM-SHA-256\$4096:MDEyMzQ1Njc4OWFiY2RlZg==\$[A-Za-z0-9+/]{43}=:[A-Za-z0-9+/]{43}=$/);
    expect(verifier).not.toContain(password);
    // Same password and salt, same result; a new salt each time otherwise.
    expect(scramVerifier(password, Buffer.from("0123456789abcdef"))).toBe(verifier);
    expect(scramVerifier(password)).not.toBe(scramVerifier(password));
  });

  it("refuses short or odd passwords rather than storing something that can't sign in", () => {
    for (const bad of ["short", "has a space in it 12345", "naïve-password-123456"]) expect(() => scramVerifier(bad)).toThrow(/database password/);
  });
});

describe("setPasswordStatement", () => {
  it("names the role and carries only the hash", () => {
    const statement = setPasswordStatement("app_admin", "correcthorsebatterystaple42");
    expect(statement).toMatch(/^ALTER ROLE app_admin PASSWORD 'SCRAM-SHA-256\$4096:[^']+'$/);
    expect(statement).not.toContain("correcthorse");
  });

  it("refuses anything that isn't a plain role name", () => {
    for (const bad of ["app_admin; DROP ROLE x", "App", "a b", "x'"]) expect(() => setPasswordStatement(bad, "correcthorsebatterystaple42")).toThrow(/role name/);
  });
});

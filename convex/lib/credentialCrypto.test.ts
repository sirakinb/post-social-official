import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openCredential, parseEncryptionKey, sealCredential } from "./credentialCrypto";

describe("credential vault cryptography", () => {
  it("round-trips an access and refresh token without storing plaintext", () => {
    const key = randomBytes(32);
    const plaintext = { accessToken: "access-example", refreshToken: "refresh-example" };
    const sealed = sealCredential(plaintext, key);
    expect(sealed.encryptedPayload).not.toContain(plaintext.accessToken);
    expect(sealed.encryptedPayload).not.toContain(plaintext.refreshToken);
    expect(openCredential(sealed, key)).toEqual(plaintext);
  });

  it("rejects tampered ciphertext", () => {
    const key = randomBytes(32);
    const sealed = sealCredential({ accessToken: "access-example" }, key);
    const tampered = `${sealed.encryptedPayload.slice(0, -2)}AA`;
    expect(() => openCredential({ ...sealed, encryptedPayload: tampered }, key)).toThrow();
  });

  it("requires a 32-byte deployment key", () => {
    expect(() => parseEncryptionKey(Buffer.from("too-short").toString("base64"))).toThrow(/32-byte key/);
  });
});


"use node";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface CredentialPlaintext {
  accessToken: string;
  refreshToken?: string;
}

export interface SealedCredential {
  encryptedPayload: string;
  initializationVector: string;
}

export function parseEncryptionKey(encoded: string | undefined) {
  if (!encoded) throw new Error("CREDENTIAL_ENCRYPTION_KEY is not configured.");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("CREDENTIAL_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  return key;
}

export function sealCredential(plaintext: CredentialPlaintext, key: Buffer): SealedCredential {
  if (key.length !== 32) throw new Error("Credential encryption requires a 32-byte key.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(plaintext), "utf8"),
    cipher.final(),
  ]);
  return {
    encryptedPayload: Buffer.concat([encrypted, cipher.getAuthTag()]).toString("base64"),
    initializationVector: iv.toString("base64"),
  };
}

export function openCredential(sealed: SealedCredential, key: Buffer): CredentialPlaintext {
  if (key.length !== 32) throw new Error("Credential encryption requires a 32-byte key.");
  const payload = Buffer.from(sealed.encryptedPayload, "base64");
  if (payload.length < 17) throw new Error("Credential payload is invalid.");
  const ciphertext = payload.subarray(0, payload.length - 16);
  const tag = payload.subarray(payload.length - 16);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(sealed.initializationVector, "base64")
  );
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  return JSON.parse(decrypted) as CredentialPlaintext;
}

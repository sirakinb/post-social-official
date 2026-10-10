// AES-256-GCM encryption for platform tokens, using Web Crypto so it runs unchanged in
// InsForge functions (Deno), the worker (Node) and tests. Format: base64(ciphertext||tag)
// plus a base64 12-byte IV, matching convex/lib/credentialCrypto.ts.

// Platforms with more to keep (Bluesky: its DPoP key and servers) store it alongside.
export type TokenSet = { accessToken: string; refreshToken?: string; [extra: string]: unknown };
export type Sealed = { encryptedPayload: string; initializationVector: string };

const ALGORITHM = "AES-GCM";

function fromBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function importKey(encoded: string | undefined) {
  if (!encoded) throw new Error("CREDENTIAL_ENCRYPTION_KEY is not configured.");
  const raw = fromBase64(encoded);
  if (raw.length !== 32) throw new Error("CREDENTIAL_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  return crypto.subtle.importKey("raw", raw, ALGORITHM, false, ["encrypt", "decrypt"]);
}

export async function seal(tokens: TokenSet | object, key: CryptoKey): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: ALGORITHM, iv }, key, new TextEncoder().encode(JSON.stringify(tokens)));
  return { encryptedPayload: toBase64(new Uint8Array(ciphertext)), initializationVector: toBase64(iv) };
}

export async function open<T = TokenSet>(sealed: Sealed, key: CryptoKey): Promise<T> {
  const plaintext = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv: fromBase64(sealed.initializationVector) },
    key,
    fromBase64(sealed.encryptedPayload),
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function randomToken(bytes = 32) {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  return toBase64(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

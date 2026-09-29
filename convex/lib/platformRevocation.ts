"use node";

import { openCredential, parseEncryptionKey } from "./credentialCrypto";

type RevocableAccount = { platform: "tiktok" | "instagram" | "facebook" | "threads" | "youtube" };
type StoredCredential = { encryptedPayload: string; initializationVector: string };

export async function revokePlatformCredential(account: RevocableAccount, credential: StoredCredential | null) {
  if (!credential) return "credential_missing";
  try {
    const opened = openCredential(
      { encryptedPayload: credential.encryptedPayload, initializationVector: credential.initializationVector },
      parseEncryptionKey(process.env.CREDENTIAL_ENCRYPTION_KEY)
    );
    const token = opened.accessToken;
    let response: Response;
    if (account.platform === "youtube") {
      // Revoking the refresh token severs the entire Google grant, which is
      // what the privacy policy promises when a user disconnects.
      const revokeToken = opened.refreshToken ?? token;
      response = await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(revokeToken)}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        signal: AbortSignal.timeout(10_000),
      });
    } else if (account.platform === "tiktok") {
      if (!process.env.TIKTOK_CLIENT_KEY || !process.env.TIKTOK_CLIENT_SECRET) throw new Error("REVOCATION_NOT_CONFIGURED");
      response = await fetch("https://open.tiktokapis.com/v2/oauth/revoke/", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_key: process.env.TIKTOK_CLIENT_KEY, client_secret: process.env.TIKTOK_CLIENT_SECRET, token }),
        signal: AbortSignal.timeout(10_000),
      });
    } else {
      const host = account.platform === "instagram"
        ? "https://graph.instagram.com"
        : account.platform === "threads"
          ? "https://graph.threads.net/v1.0"
          : "https://graph.facebook.com/v23.0";
      response = await fetch(`${host}/me/permissions`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      });
    }
    return response.ok ? "confirmed" : `platform_http_${response.status}`;
  } catch (cause) {
    return cause instanceof Error && cause.message === "REVOCATION_NOT_CONFIGURED" ? "skipped_configuration" : "platform_unreachable";
  }
}

// A connected account's current access token, renewed and saved when it is about to
// expire. Shared by publishing and analytics.
import type { Sql } from "../../backend/lib/access";
import { importKey, open, seal } from "../../backend/lib/connections/crypto";
import { refreshTokens, type Platform, type Settings } from "../../backend/lib/connections/platforms";
import { PublishError } from "./publish/types";

export type CredentialDeps = { sql: Sql; setting: Settings; http?: typeof fetch };
export type AccountRef = { id: string; platform: Platform; displayName: string };

export async function accountToken(deps: CredentialDeps, account: AccountRef, now: () => number = Date.now) {
  const [credential] = await deps.sql<{ id: string; encrypted_payload: string; initialization_vector: string; access_token_expires_at: string | null }>(
    `SELECT id, encrypted_payload, initialization_vector, access_token_expires_at FROM public.credentials WHERE connected_account_id = $1`,
    [account.id],
  );
  if (!credential) throw new PublishError("credential_missing", `${account.displayName} has no saved access. Reconnect it.`, false, undefined, true);
  const key = await importKey(deps.setting("CREDENTIAL_ENCRYPTION_KEY"));
  const tokens = await open({ encryptedPayload: credential.encrypted_payload, initializationVector: credential.initialization_vector }, key);
  const expires = credential.access_token_expires_at ? Date.parse(credential.access_token_expires_at) : Infinity;
  if (expires - now() > 5 * 60_000) return tokens.accessToken;

  const refreshed = await refreshTokens(account.platform, tokens, deps.setting, deps.http).catch((error) => {
    throw new PublishError("access_expired", `${account.displayName}'s access expired and could not be renewed (${error instanceof Error ? error.message : "unknown"}). Reconnect it.`, false, undefined, true);
  });
  if (!refreshed) return tokens.accessToken;
  const sealed = await seal(refreshed.tokens, key);
  await deps.sql(
    `UPDATE public.credentials SET encrypted_payload = $2, initialization_vector = $3, access_token_expires_at = $4,
       refresh_token_expires_at = coalesce($5, refresh_token_expires_at) WHERE id = $1`,
    [credential.id, sealed.encryptedPayload, sealed.initializationVector, refreshed.accessTokenExpiresAt?.toISOString() ?? null, refreshed.refreshTokenExpiresAt?.toISOString() ?? null],
  );
  return refreshed.tokens.accessToken;
}

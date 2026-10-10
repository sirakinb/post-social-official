// A connected account's current access token, renewed and saved when it is about to
// expire. Shared by publishing and analytics.
import type { Sql } from "../../backend/lib/access";
import { importKey, open, seal, type TokenSet } from "../../backend/lib/connections/crypto";
import { refreshTokens, type Platform, type Settings } from "../../backend/lib/connections/platforms";
import { PublishError } from "./publish/types";

export type CredentialDeps = { sql: Sql; setting: Settings; http?: typeof fetch; sleep?: (ms: number) => Promise<void> };
export type AccountRef = { id: string; platform: Platform; displayName: string };

type Row = { id: string; encrypted_payload: string; initialization_vector: string; access_token_expires_at: string | null };

export async function accountToken(deps: CredentialDeps, account: AccountRef, now: () => number = Date.now) {
  return (await accountSession(deps, account, now)).accessToken;
}

// Everything saved for the account (Bluesky keeps its DPoP key and servers with the tokens).
export async function accountSession(deps: CredentialDeps, account: AccountRef, now: () => number = Date.now): Promise<TokenSet> {
  const key = await importKey(deps.setting("CREDENTIAL_ENCRYPTION_KEY"));
  const load = async () => {
    const [credential] = await deps.sql<Row>(
      `SELECT id, encrypted_payload, initialization_vector, access_token_expires_at FROM public.credentials WHERE connected_account_id = $1`,
      [account.id],
    );
    if (!credential) throw new PublishError("credential_missing", `${account.displayName} has no saved access. Reconnect it.`, false, undefined, true);
    const tokens = await open({ encryptedPayload: credential.encrypted_payload, initializationVector: credential.initialization_vector }, key);
    // Bluesky's expiry is inside the session (its access lasts minutes, see refreshTokens).
    const expires = typeof tokens.accessExpiresAt === "number" ? tokens.accessExpiresAt : credential.access_token_expires_at ? Date.parse(credential.access_token_expires_at) : Infinity;
    return { credential, tokens, expires };
  };

  let { credential, tokens, expires } = await load();
  if (expires - now() > 5 * 60_000) return tokens;

  // Bluesky and X refresh tokens work once, so only one worker may renew at a time: take the
  // credential's lease, and if someone else holds it, wait for their new tokens.
  const rotating = account.platform === "bluesky" || account.platform === "x";
  if (rotating) {
    let leased = false;
    for (let attempt = 0; attempt < 10 && !leased; attempt++) {
      const [row] = await deps.sql<{ id: string }>(
        `UPDATE public.credentials SET refresh_lease_until = now() + interval '60 seconds'
         WHERE id = $1 AND (refresh_lease_until IS NULL OR refresh_lease_until < now()) RETURNING id`,
        [credential.id],
      );
      leased = Boolean(row);
      if (!leased) {
        await (deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(1_000);
        ({ credential, tokens, expires } = await load());
        if (expires - now() > 5 * 60_000) return tokens;
      }
    }
    if (!leased) throw new PublishError("access_busy", `${account.displayName}'s access is being renewed. Post Social will try again shortly.`, true);
    // Someone may have renewed it between our read and the lease.
    ({ credential, tokens, expires } = await load());
    if (expires - now() > 5 * 60_000) {
      await deps.sql(`UPDATE public.credentials SET refresh_lease_until = NULL WHERE id = $1`, [credential.id]);
      return tokens;
    }
  }

  try {
    const refreshed = await refreshTokens(account.platform, tokens, deps.setting, deps.http).catch((error) => {
      throw new PublishError("access_expired", `${account.displayName}'s access expired and could not be renewed (${error instanceof Error ? error.message : "unknown"}). Reconnect it.`, false, undefined, true);
    });
    if (!refreshed) {
      // Nothing to renew with (LinkedIn without a refresh token).
      if (expires <= now()) throw new PublishError("access_expired", `${account.displayName}'s access expired. Reconnect it.`, false, undefined, true);
      return tokens;
    }
    const sealed = await seal(refreshed.tokens, key);
    await deps.sql(
      `UPDATE public.credentials SET encrypted_payload = $2, initialization_vector = $3, access_token_expires_at = $4,
         refresh_token_expires_at = coalesce($5, refresh_token_expires_at), refresh_lease_until = NULL WHERE id = $1`,
      [credential.id, sealed.encryptedPayload, sealed.initializationVector, refreshed.accessTokenExpiresAt?.toISOString() ?? null, refreshed.refreshTokenExpiresAt?.toISOString() ?? null],
    );
    return refreshed.tokens;
  } finally {
    if (rotating) await deps.sql(`UPDATE public.credentials SET refresh_lease_until = NULL WHERE id = $1 AND refresh_lease_until IS NOT NULL`, [credential.id]).catch(() => undefined);
  }
}

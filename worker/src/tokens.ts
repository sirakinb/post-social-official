// Refreshes platform tokens before they expire.
import type { Sql } from "../../backend/lib/access";
import { importKey, open, seal } from "../../backend/lib/connections/crypto";
import { DISPLAY_NAMES, PlatformError, refreshTokens, type Platform, type Settings } from "../../backend/lib/connections/platforms";

// How long before expiry each platform's access is refreshed.
const REFRESH_WINDOW_MS: Record<Platform, number> = {
  youtube: 15 * 60 * 1000,
  tiktok: 3 * 60 * 60 * 1000,
  instagram: 7 * 24 * 60 * 60 * 1000,
  threads: 7 * 24 * 60 * 60 * 1000,
  facebook: 0, // Page tokens do not expire.
};

type Claimed = {
  id: string;
  workspace_id: string;
  connected_account_id: string;
  encrypted_payload: string;
  initialization_vector: string;
  access_token_expires_at: string | null;
  refresh_token_expires_at: string | null;
};

export type TokenDeps = { sql: Sql; setting: Settings; http?: typeof fetch; now?: () => number };

export async function refreshDueTokens(deps: TokenDeps) {
  const now = deps.now ?? Date.now;
  const claimed = await deps.sql<Claimed>(`SELECT * FROM public.claim_credentials_to_refresh(interval '7 days', 300, 20)`, []);
  if (!claimed.length) return 0;
  const key = await importKey(deps.setting("CREDENTIAL_ENCRYPTION_KEY"));
  let refreshed = 0;

  for (const credential of claimed) {
    const [account] = await deps.sql<{ platform: Platform; display_name: string; health: string }>(
      `SELECT platform, display_name, health FROM public.connected_accounts WHERE id = $1`,
      [credential.connected_account_id],
    );
    const expiresAt = credential.access_token_expires_at ? Date.parse(credential.access_token_expires_at) : Infinity;
    if (!account || expiresAt - now() > REFRESH_WINDOW_MS[account.platform]) {
      await release(deps, credential.id);
      continue;
    }

    try {
      const current = await open({ encryptedPayload: credential.encrypted_payload, initializationVector: credential.initialization_vector }, key);
      const result = await refreshTokens(account.platform, current, deps.setting, deps.http);
      if (!result) {
        await release(deps, credential.id);
        continue;
      }
      const sealed = await seal(result.tokens, key);
      // Only write if the row was not replaced meanwhile (e.g. the person reconnected).
      await deps.sql(
        `WITH updated AS (
           UPDATE public.credentials
           SET encrypted_payload = $2, initialization_vector = $3, access_token_expires_at = $4,
               refresh_token_expires_at = coalesce($5, refresh_token_expires_at), refresh_lease_until = NULL
           WHERE id = $1 AND encrypted_payload = $6
           RETURNING connected_account_id
         )
         UPDATE public.connected_accounts SET health = 'connected', health_reason = NULL, last_verified_at = now()
         WHERE id IN (SELECT connected_account_id FROM updated) AND health = 'needs_attention'`,
        [credential.id, sealed.encryptedPayload, sealed.initializationVector, result.accessTokenExpiresAt?.toISOString() ?? null, result.refreshTokenExpiresAt?.toISOString() ?? null, credential.encrypted_payload],
      );
      refreshed++;
    } catch (error) {
      // A platform refusal (4xx) or an access token that has already expired means the
      // person must reconnect. Anything else (network, 5xx) is retried on the next run.
      const refused = error instanceof PlatformError && /^http_4|^(invalid|access_token|refresh_token)/.test(error.code);
      if (refused || expiresAt <= now()) {
        const reason = `${DISPLAY_NAMES[account.platform]} access expired. Reconnect this account to keep posting.`;
        await deps.sql(
          `WITH flagged AS (
             UPDATE public.connected_accounts SET health = 'needs_attention', health_reason = $2
             WHERE id = $1 AND health = 'connected' RETURNING id, workspace_id
           )
           INSERT INTO public.audit_events (workspace_id, entry_point, event_type, entity_type, entity_id, summary, after_values)
           SELECT workspace_id, 'worker', 'account.refresh_failed', 'account', id, $3, jsonb_build_object('reason', $4::text) FROM flagged`,
          [credential.connected_account_id, reason, `Could not refresh ${account.display_name}`, error instanceof Error ? error.message.slice(0, 300) : "unknown"],
        );
      }
      await release(deps, credential.id);
    }
  }
  return refreshed;
}

async function release(deps: TokenDeps, credentialId: string) {
  await deps.sql(`UPDATE public.credentials SET refresh_lease_until = NULL WHERE id = $1`, [credentialId]);
}

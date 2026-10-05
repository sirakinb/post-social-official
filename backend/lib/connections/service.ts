// Connecting social accounts: start a platform sign-in, finish it on the callback, and
// disconnect. Tokens are encrypted before they are stored; every change is audited.
import { ApiError, isAgentCaller, membership, requireUuid, type Caller, type Sql } from "../access";
import { importKey, open, randomToken, seal, sha256Hex } from "./crypto";
import { DISPLAY_NAMES, PLATFORMS, PlatformError, authorizeUrl, exchangeCode, revokeTokens, type Platform, type Settings } from "./platforms";

export type ConnectionDeps = {
  sql: Sql;
  setting: Settings;
  // Origins the person may be sent back to after signing in (the web app).
  allowedReturnOrigins: string[];
  http?: typeof fetch;
};

const STATE_MINUTES = 10;

export function isPlatform(value: unknown): value is Platform {
  return typeof value === "string" && (PLATFORMS as string[]).includes(value);
}

// The platform sends people back here. YouTube is the exception: Google only allows
// callbacks on domains we own, so its callback is on the web app, which forwards here.
export function callbackUrl(platform: Platform, setting: Settings) {
  if (platform === "youtube") return setting("GOOGLE_REDIRECT_URI");
  return `${setting("CONNECTIONS_BASE_URL")}/oauth/${platform}/callback`;
}

export function originAllowedFor(returnTo: string, allowed: string[]) {
  let origin: string;
  try {
    origin = new URL(returnTo).origin;
  } catch {
    return false;
  }
  return allowed.some((pattern) => {
    if (!pattern.includes("*")) return pattern === origin;
    const [prefix, suffix] = pattern.split("*");
    const middle = origin.slice(prefix.length, origin.length - suffix.length);
    return origin.startsWith(prefix) && origin.endsWith(suffix) && origin.length >= prefix.length + suffix.length && /^[a-z0-9-]*$/i.test(middle);
  });
}

export async function startConnection(deps: ConnectionDeps, caller: Caller, input: { workspace_id?: unknown; platform?: unknown; return_to?: unknown }) {
  const workspaceId = requireUuid(input.workspace_id, "Workspace");
  if (!isPlatform(input.platform)) throw new ApiError(400, `Choose a platform: ${PLATFORMS.join(", ")}.`);
  const returnTo = typeof input.return_to === "string" ? input.return_to : "";
  if (returnTo && !originAllowedFor(returnTo, deps.allowedReturnOrigins)) throw new ApiError(400, "That return address is not allowed.");
  // Signing in to a platform is the person's step; AIs hand them a connect link instead.
  if (isAgentCaller(caller)) throw new ApiError(403, "Accounts are connected by a person in the Post Social web app. Use a connect link.");
  await membership(deps.sql, caller, workspaceId, true, "Reviewers cannot connect accounts.");

  const state = randomToken();
  await deps.sql(
    `INSERT INTO public.oauth_states (workspace_id, user_id, provider, state_hash, expires_at, return_to)
     VALUES ($1, $2, $3, $4, now() + make_interval(mins => $5), $6)`,
    [workspaceId, caller.userId, input.platform, await sha256Hex(state), STATE_MINUTES, returnTo || null],
  );
  return { url: authorizeUrl(input.platform, state, callbackUrl(input.platform, deps.setting), deps.setting), expires_in_seconds: STATE_MINUTES * 60 };
}

type StateRow = { workspace_id: string; user_id: string | null; return_to: string | null };

export type CallbackResult = { returnTo: string | null; ok: boolean; message: string; platform: Platform };

// Finishes a sign-in. Always resolves with where to send the person and what to tell them.
export async function completeConnection(deps: ConnectionDeps, platform: Platform, params: URLSearchParams): Promise<CallbackResult> {
  const state = params.get("state") ?? "";
  // Single use: the state is marked used in the same statement that reads it.
  const [session] = state
    ? await deps.sql<StateRow>(
        `UPDATE public.oauth_states SET used_at = now()
         WHERE state_hash = $1 AND provider = $2 AND used_at IS NULL AND expires_at > now()
         RETURNING workspace_id, user_id, return_to`,
        [await sha256Hex(state), platform],
      )
    : [];
  const name = DISPLAY_NAMES[platform];
  if (!session) return { returnTo: null, ok: false, platform, message: `The ${name} connection request expired or was already used. Start again.` };
  const fail = (message: string): CallbackResult => ({ returnTo: session.return_to, ok: false, platform, message });

  const denied = params.get("error") ?? params.get("error_reason");
  if (denied) return fail(`${name} did not grant access${params.get("error_description") ? `: ${params.get("error_description")}` : "."}`);
  const code = params.get("code");
  if (!code) return fail(`${name} did not return a sign-in code. Start again.`);

  // The person who started the sign-in must still be a member who can connect accounts.
  const [member] = await deps.sql<{ role: string; actor_id: string | null }>(
    `SELECT m.role, (SELECT a.id FROM public.actors a WHERE a.workspace_id = m.workspace_id AND a.user_id = m.user_id AND a.kind = 'user') AS actor_id
     FROM public.workspace_members m WHERE m.workspace_id = $1 AND m.user_id = $2`,
    [session.workspace_id, session.user_id],
  );
  if (!member || member.role === "reviewer") return fail("You can no longer connect accounts in this workspace.");

  let identities;
  try {
    identities = await exchangeCode(platform, code, callbackUrl(platform, deps.setting), deps.setting, deps.http);
  } catch (error) {
    return fail(error instanceof PlatformError ? error.message : `${name} sign-in failed. Try again.`);
  }

  const externalIdOf = (identity: (typeof identities)[number]) => identity.externalAccountId || `workspace:${session.workspace_id}`;
  // One social account belongs to one workspace. Check every account first, so a
  // Facebook sign-in that returns several Pages connects all of them or none.
  for (const identity of identities) {
    const [elsewhere] = await deps.sql<{ id: string }>(
      `SELECT id FROM public.connected_accounts
       WHERE platform = $1 AND external_account_id = $2 AND workspace_id <> $3 AND health <> 'disconnected'`,
      [platform, externalIdOf(identity), session.workspace_id],
    );
    if (elsewhere) return fail(`${identity.displayName} is already connected to another workspace. Disconnect it there first.`);
  }

  const key = await importKey(deps.setting("CREDENTIAL_ENCRYPTION_KEY"));
  const connected: string[] = [];
  for (const identity of identities) {
    const externalId = externalIdOf(identity);
    const sealed = await seal(identity.tokens, key);
    // Reconnecting updates the same row instead of creating a duplicate.
    await deps.sql(
      `WITH account AS (
         INSERT INTO public.connected_accounts
           (workspace_id, platform, external_account_id, owner_external_id, handle, display_name, avatar_url,
            scopes, capabilities, health, health_reason, connected_by_actor_id, last_verified_at, disconnected_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, 'connected', NULL, $10, now(), NULL)
         ON CONFLICT (workspace_id, platform, external_account_id) DO UPDATE SET
           owner_external_id = EXCLUDED.owner_external_id, handle = EXCLUDED.handle, display_name = EXCLUDED.display_name,
           avatar_url = EXCLUDED.avatar_url, scopes = EXCLUDED.scopes, capabilities = EXCLUDED.capabilities,
           health = 'connected', health_reason = NULL, last_verified_at = now(), disconnected_at = NULL
         RETURNING id, (xmax = 0) AS created
       ), credential AS (
         INSERT INTO public.credentials
           (workspace_id, connected_account_id, encrypted_payload, initialization_vector, key_version,
            access_token_expires_at, refresh_token_expires_at)
         SELECT $1, id, $11, $12, 1, $13, $14 FROM account
         ON CONFLICT (connected_account_id) DO UPDATE SET
           encrypted_payload = EXCLUDED.encrypted_payload, initialization_vector = EXCLUDED.initialization_vector,
           access_token_expires_at = EXCLUDED.access_token_expires_at, refresh_token_expires_at = EXCLUDED.refresh_token_expires_at,
           refresh_lease_until = NULL
       ), usage AS (
         INSERT INTO public.usage_events (workspace_id, actor_id, event_type, quantity)
         SELECT $1, $10, 'account_connected', 1 FROM account WHERE created
       )
       INSERT INTO public.audit_events (workspace_id, actor_id, entry_point, event_type, entity_type, entity_id, summary, after_values)
       SELECT $1, $10, 'ui', CASE WHEN created THEN 'account.connected' ELSE 'account.reconnected' END, 'account', id, $15,
              jsonb_build_object('platform', $2::text, 'handle', $5::text)
       FROM account`,
      [
        session.workspace_id, platform, externalId, identity.ownerExternalId ?? null, identity.handle, identity.displayName,
        identity.avatarUrl ?? null, identity.scopes, JSON.stringify(identity.capabilities), member.actor_id,
        sealed.encryptedPayload, sealed.initializationVector,
        identity.accessTokenExpiresAt?.toISOString() ?? null, identity.refreshTokenExpiresAt?.toISOString() ?? null,
        `Connected ${name} account ${identity.displayName}`,
      ],
    );
    connected.push(identity.displayName);
  }
  return { returnTo: session.return_to, ok: true, platform, message: `Connected ${connected.join(", ")}.` };
}

type AccountRow = { id: string; workspace_id: string; platform: Platform; display_name: string; health: string };

export async function disconnectAccount(deps: ConnectionDeps, caller: Caller, input: { account_id?: unknown }) {
  const accountId = requireUuid(input.account_id, "Account");
  const [account] = await deps.sql<AccountRow>(`SELECT id, workspace_id, platform, display_name, health FROM public.connected_accounts WHERE id = $1`, [accountId]);
  if (!account) throw new ApiError(404, "That account was not found.");
  const member = await membership(deps.sql, caller, account.workspace_id, true, "Reviewers cannot disconnect accounts.").catch((error) => {
    if (error instanceof ApiError && error.status === 404) throw new ApiError(404, "That account was not found.");
    throw error;
  });
  if (account.health === "disconnected") return { account_id: accountId, status: "disconnected", revoked: "already_disconnected", cancelled_destinations: 0 };

  // Revoke at the platform first: after disconnect_account the token is gone.
  let revoked = "credential_missing";
  const [credential] = await deps.sql<{ encrypted_payload: string; initialization_vector: string }>(
    `SELECT encrypted_payload, initialization_vector FROM public.credentials WHERE connected_account_id = $1`,
    [accountId],
  );
  if (credential) {
    try {
      const tokens = await open({ encryptedPayload: credential.encrypted_payload, initializationVector: credential.initialization_vector }, await importKey(deps.setting("CREDENTIAL_ENCRYPTION_KEY")));
      revoked = await revokeTokens(account.platform, tokens, deps.setting, deps.http);
    } catch {
      revoked = "credential_unreadable";
    }
  }

  const [result] = await deps.sql<{ cancelled: number }>(
    `WITH done AS (SELECT public.disconnect_account($1, 'Disconnected by a workspace member.') AS cancelled),
     audit AS (
       INSERT INTO public.audit_events (workspace_id, actor_id, entry_point, event_type, entity_type, entity_id, summary, after_values)
       SELECT $2, $3, $4, 'account.disconnected', 'account', $1, $5,
              jsonb_build_object('revoked_at_platform', $6::text, 'cancelled_destinations', cancelled) FROM done
     )
     SELECT cancelled FROM done`,
    [accountId, account.workspace_id, member.actor_id, caller.entryPoint, `Disconnected ${DISPLAY_NAMES[account.platform]} account ${account.display_name}`, revoked],
  );
  return { account_id: accountId, status: "disconnected", revoked, cancelled_destinations: Number(result?.cancelled ?? 0) };
}

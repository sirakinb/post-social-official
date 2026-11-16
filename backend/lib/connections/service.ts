// Connecting social accounts: start a platform sign-in, finish it on the callback, and
// disconnect. Tokens are encrypted before they are stored; every change is audited.
import { ApiError, isAgentCaller, membership, requireUuid, type Caller, type Sql } from "../access";
import { accountLimitMessage } from "../billing";
import { trackEvent } from "../telemetry";
import { importKey, open, randomToken, seal, sha256Hex } from "./crypto";
import { AtprotoError, finishSignIn, publicProfile, startSignIn, type PendingSignIn } from "./atproto";
import { XError, finishXSignIn, startXSignIn, type PendingX } from "./x";
import { CAPABILITIES, DISPLAY_NAMES, PLATFORMS, PlatformError, authorizeUrl, exchangeCode, revokeTokens, type Identity, type Platform, type Settings } from "./platforms";

export type ConnectionDeps = {
  sql: Sql;
  setting: Settings;
  // Origins the person may be sent back to after signing in (the web app).
  allowedReturnOrigins: string[];
  http?: typeof fetch;
  // Called after accounts are added or removed (keeps the billed account count in step).
  // Best effort: a billing hiccup never undoes a connection.
  afterAccountsChanged?: (workspaceId: string) => Promise<unknown>;
};

const STATE_MINUTES = 10;

export function isPlatform(value: unknown): value is Platform {
  return typeof value === "string" && (PLATFORMS as string[]).includes(value);
}

// The platform sends people back here. YouTube is the exception: Google only allows
// callbacks on domains we own, so its callback is on the web app, which forwards here.
// TikTok can be pointed at another address it has already approved (TIKTOK_REDIRECT_URI,
// the old Convex deployment's callback, which forwards here) while a new address waits for
// its review. That deployment's code is gone from this repo; see docs/environments.md.
export function callbackUrl(platform: Platform, setting: Settings) {
  if (platform === "youtube") return setting("GOOGLE_REDIRECT_URI");
  if (platform === "tiktok") {
    const override = optionalSetting(setting, "TIKTOK_REDIRECT_URI");
    if (override) return override;
  }
  return `${setting("CONNECTIONS_BASE_URL")}/oauth/${platform}/callback`;
}

function optionalSetting(setting: Settings, name: string) {
  try {
    return setting(name).trim() || null;
  } catch {
    return null;
  }
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

export async function startConnection(deps: ConnectionDeps, caller: Caller, input: { workspace_id?: unknown; platform?: unknown; return_to?: unknown; handle?: unknown; profile_id?: unknown }) {
  const workspaceId = requireUuid(input.workspace_id, "Workspace");
  if (!isPlatform(input.platform)) throw new ApiError(400, `Choose a platform: ${PLATFORMS.join(", ")}.`);
  const returnTo = typeof input.return_to === "string" ? input.return_to : "";
  if (returnTo && !originAllowedFor(returnTo, deps.allowedReturnOrigins)) throw new ApiError(400, "That return address is not allowed.");
  // Signing in to a platform is the person's step; AIs hand them a connect link instead.
  if (isAgentCaller(caller)) throw new ApiError(403, "Accounts are connected by a person in the Post Social web app. Use a connect link.");
  await membership(deps.sql, caller, workspaceId, true, "Reviewers cannot connect accounts.");
  // At the plan's account limit, say so before the platform's sign-in rather than after it.
  // Reconnecting goes through: a platform the workspace already has an account on may be a
  // reconnect (the database still refuses a genuinely new account over the limit).
  const [limit] = await deps.sql<{ plan_name: string; max: number; connected: number; on_platform: number }>(
    `SELECT p.name AS plan_name, p.max_connected_accounts AS max,
            (SELECT count(*)::int FROM public.connected_accounts a WHERE a.workspace_id = $1 AND a.health <> 'disconnected') AS connected,
            (SELECT count(*)::int FROM public.connected_accounts a WHERE a.workspace_id = $1 AND a.platform = $2 AND a.health <> 'disconnected') AS on_platform
     FROM public.plans p WHERE p.id = coalesce((SELECT plan_id FROM public.workspace_plans WHERE workspace_id = $1), 'tester')`,
    [workspaceId, input.platform],
  );
  if (limit && limit.connected >= limit.max && limit.on_platform === 0) {
    throw new ApiError(402, accountLimitMessage(new Error(`Your ${limit.plan_name} plan allows ${limit.max} connected accounts`)) ?? "This workspace is at its account limit.");
  }
  // The profile the new account goes into, if one was chosen.
  let profileId: string | null = null;
  if (input.profile_id !== undefined && input.profile_id !== null && input.profile_id !== "") {
    const [profile] = await deps.sql<{ id: string }>(`SELECT id FROM public.profiles WHERE id = $1 AND workspace_id = $2`, [requireUuid(input.profile_id, "Profile"), workspaceId]);
    if (!profile) throw new ApiError(404, "That profile was not found.");
    profileId = profile.id;
  }

  const state = randomToken();
  const redirectUri = callbackUrl(input.platform, deps.setting);
  let url: string;
  let pending: string | null = null;
  if (input.platform === "bluesky") {
    // Bluesky's sign-in is pushed to the account's server first; what it needs to finish
    // (the PKCE verifier and the DPoP key) is kept encrypted with the state.
    const started = await startSignIn(deps.setting, deps.http ?? fetch, state, redirectUri, input.handle).catch((error) => {
      throw new ApiError(400, error instanceof AtprotoError ? error.message : "Bluesky sign-in could not start. Try again.");
    });
    url = started.url;
    const sealed = await seal(started.pending, await importKey(deps.setting("CREDENTIAL_ENCRYPTION_KEY")));
    pending = JSON.stringify(sealed);
  } else if (input.platform === "x") {
    const started = await startXSignIn(deps.setting, state, redirectUri);
    url = started.url;
    pending = JSON.stringify(await seal(started.pending, await importKey(deps.setting("CREDENTIAL_ENCRYPTION_KEY"))));
  } else {
    url = authorizeUrl(input.platform, state, redirectUri, deps.setting, workspaceId);
  }
  await deps.sql(
    `INSERT INTO public.oauth_states (workspace_id, user_id, provider, state_hash, expires_at, return_to, code_verifier_encrypted, profile_id)
     VALUES ($1, $2, $3, $4, now() + make_interval(mins => $5), $6, $7, $8)`,
    [workspaceId, caller.userId, input.platform, await sha256Hex(state), STATE_MINUTES, returnTo || null, pending, profileId],
  );
  return { url, expires_in_seconds: STATE_MINUTES * 60 };
}

async function xIdentity(deps: ConnectionDeps, pendingSealed: string | null, code: string, redirectUri: string): Promise<Identity[]> {
  if (!pendingSealed) throw new PlatformError("This X sign-in is missing its details. Start again.");
  const pending = await open<PendingX>(JSON.parse(pendingSealed), await importKey(deps.setting("CREDENTIAL_ENCRYPTION_KEY")));
  const signedIn = await finishXSignIn(deps.setting, deps.http ?? fetch, pending, code, redirectUri);
  return [{
    externalAccountId: signedIn.id,
    ownerExternalId: signedIn.id,
    handle: signedIn.username,
    displayName: signedIn.name,
    avatarUrl: signedIn.avatar ?? undefined,
    scopes: signedIn.scope.split(" ").filter(Boolean),
    tokens: signedIn.tokens,
    // The access expiry stays with the tokens (see refreshTokens).
    capabilities: CAPABILITIES.x,
  }];
}

async function blueskyIdentity(deps: ConnectionDeps, pendingSealed: string | null, params: URLSearchParams, redirectUri: string): Promise<Identity[]> {
  if (!pendingSealed) throw new PlatformError("This Bluesky sign-in is missing its details. Start again.");
  const key = await importKey(deps.setting("CREDENTIAL_ENCRYPTION_KEY"));
  const pending = await open<PendingSignIn>(JSON.parse(pendingSealed), key);
  const http = deps.http ?? fetch;
  const { session, handle, scope } = await finishSignIn(deps.setting, http, pending, params, redirectUri);
  const profile = await publicProfile(http, session.did).catch(() => null);
  const shownHandle = profile?.handle ?? handle ?? session.did;
  return [{
    externalAccountId: session.did,
    ownerExternalId: session.did,
    handle: shownHandle,
    displayName: profile?.displayName ?? shownHandle,
    avatarUrl: profile?.avatar ?? undefined,
    scopes: scope.split(" ").filter(Boolean),
    tokens: session,
    // The access expiry stays inside the session (see refreshTokens).
    capabilities: CAPABILITIES.bluesky,
  }];
}

type StateRow = { workspace_id: string; user_id: string | null; return_to: string | null; code_verifier_encrypted: string | null; profile_id: string | null };

// choose: a waiting sign-in where the person picks which new accounts to add.
export type CallbackResult = { returnTo: string | null; ok: boolean; message: string; platform: Platform; choose?: string };

// Where the platform's callback should send the browser to finish: the web app the
// sign-in started from (its address was checked when the sign-in started). Reads the state
// without using it up.
export async function finishingOrigin(deps: ConnectionDeps, platform: Platform, state: string | null): Promise<string | null> {
  if (!state) return null;
  const [row] = await deps.sql<{ return_to: string | null }>(
    `SELECT return_to FROM public.oauth_states WHERE state_hash = $1 AND provider = $2 AND used_at IS NULL AND expires_at > now()`,
    [await sha256Hex(state), platform],
  );
  if (!row) return null;
  try {
    return row.return_to ? new URL(row.return_to).origin : null;
  } catch {
    return null;
  }
}

// Finishes a sign-in for the signed-in person who started it. Always resolves with where
// to send the person and what to tell them.
//
// The platform's callback can be opened by anyone holding the sign-in link, so finishing
// is bound to the person: someone tricked into approving another person's link (signed in
// as themselves, or not at all) can't attach their account to that person's workspace.
export async function completeConnection(deps: ConnectionDeps, platform: Platform, params: URLSearchParams, userId: string): Promise<CallbackResult> {
  const state = params.get("state") ?? "";
  // Single use, and only by the person who started it: the state is marked used in the
  // same statement that reads it, so a mismatch leaves it unused.
  const [session] = state
    ? await deps.sql<StateRow>(
        `UPDATE public.oauth_states SET used_at = now()
         WHERE state_hash = $1 AND provider = $2 AND user_id = $3 AND used_at IS NULL AND expires_at > now()
         RETURNING workspace_id, user_id, return_to, code_verifier_encrypted, profile_id`,
        [await sha256Hex(state), platform, userId],
      )
    : [];
  const name = DISPLAY_NAMES[platform];
  if (!session) return { returnTo: null, ok: false, platform, message: `This ${name} connection request expired, was already used, or was started by someone else. Start again from your own account.` };
  const fail = (message: string): CallbackResult => ({ returnTo: session.return_to, ok: false, platform, message });

  const denied = params.get("error") ?? params.get("error_reason");
  if (denied) return fail(`${name} did not grant access${params.get("error_description") ? `: ${params.get("error_description")}` : "."}`);
  const code = params.get("code");
  if (!code) return fail(`${name} did not return a sign-in code. Start again.`);
  // Bluesky's code arrives with the server that issued it (iss) and is finished below.

  // The person who started the sign-in must still be a member who can connect accounts.
  const [member] = await deps.sql<{ role: string; actor_id: string | null }>(
    `SELECT m.role, (SELECT a.id FROM public.actors a WHERE a.workspace_id = m.workspace_id AND a.user_id = m.user_id AND a.kind = 'user') AS actor_id
     FROM public.workspace_members m WHERE m.workspace_id = $1 AND m.user_id = $2`,
    [session.workspace_id, session.user_id],
  );
  if (!member || member.role === "reviewer") return fail("You can no longer connect accounts in this workspace.");

  let identities;
  try {
    identities = platform === "bluesky"
      ? await blueskyIdentity(deps, session.code_verifier_encrypted, params, callbackUrl(platform, deps.setting))
      : platform === "x"
        ? await xIdentity(deps, session.code_verifier_encrypted, code, callbackUrl(platform, deps.setting))
        : await exchangeCode(platform, code, callbackUrl(platform, deps.setting), deps.setting, deps.http);
  } catch (error) {
    return fail(error instanceof PlatformError || error instanceof AtprotoError || error instanceof XError ? error.message : `${name} sign-in failed. Try again.`);
  }

  const externalIdOf = (identity: Identity) => identity.externalAccountId || `workspace:${session.workspace_id}`;
  // One social account belongs to one workspace. A Facebook sign-in returns every Page the
  // person ever shared with Post Social, so Pages already connected in another workspace are
  // skipped and the rest connect; it fails only when nothing is left.
  const available: Identity[] = [];
  const skipped: string[] = [];
  for (const identity of identities) {
    const [elsewhere] = await deps.sql<{ id: string }>(
      `SELECT id FROM public.connected_accounts
       WHERE platform = $1 AND external_account_id = $2 AND workspace_id <> $3 AND health <> 'disconnected'`,
      [platform, externalIdOf(identity), session.workspace_id],
    );
    if (elsewhere) skipped.push(identity.displayName);
    else available.push(identity);
  }
  if (!available.length) {
    return fail(`${skipped.join(", ")} ${skipped.length > 1 ? "are" : "is"} already connected to another workspace. Disconnect ${skipped.length > 1 ? "them" : "it"} there first.`);
  }
  const skippedNote = skipped.length ? ` Skipped ${skipped.join(", ")}: already connected to another workspace.` : "";
  const target: SaveTarget = { workspaceId: session.workspace_id, userId: session.user_id, actorId: member.actor_id, profileId: session.profile_id, platform };
  if (platform === "linkedin" && member.actor_id) await adoptOriginalProfile(deps, session.workspace_id, member.actor_id, available);

  // A LinkedIn sign-in can bring several accounts (the profile and the member's Pages), each
  // billed once connected. Accounts this workspace already has reconnect now; when that
  // leaves more than one new account, the person chooses which to add.
  if (platform === "linkedin" && available.length > 1) {
    const known = new Set((await deps.sql<{ external_account_id: string }>(
      `SELECT external_account_id FROM public.connected_accounts
       WHERE workspace_id = $1 AND platform = $2 AND external_account_id = ANY($3::text[]) AND health <> 'disconnected'`,
      [session.workspace_id, platform, available.map(externalIdOf)],
    )).map((row) => row.external_account_id));
    const reconnect = available.filter((identity) => known.has(externalIdOf(identity)));
    const fresh = available.filter((identity) => !known.has(externalIdOf(identity)));
    if (fresh.length > 1 || (fresh.length === 1 && reconnect.length > 0)) {
      const saved = reconnect.length ? await saveIdentities(deps, target, reconnect) : { connected: [] as string[] };
      if (saved.problem) return fail(saved.problem);
      // Waiting sign-ins nobody finished are cleared here, so their tokens don't linger.
      await deps.sql(`DELETE FROM public.pending_connections WHERE expires_at < now()`, []);
      const sealed = await seal(fresh, await importKey(deps.setting("CREDENTIAL_ENCRYPTION_KEY")));
      const [pending] = await deps.sql<{ id: string }>(
        `INSERT INTO public.pending_connections (workspace_id, user_id, platform, profile_id, return_to, choices, encrypted_payload, initialization_vector)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8) RETURNING id`,
        [session.workspace_id, session.user_id, platform, session.profile_id, session.return_to, JSON.stringify(fresh.map(choiceOf)), sealed.encryptedPayload, sealed.initializationVector],
      );
      const refreshed = saved.connected.length ? `Reconnected ${saved.connected.join(", ")}. ` : "";
      return { returnTo: session.return_to, ok: true, platform, choose: pending.id, message: `${refreshed}Choose which ${name} accounts to add.${skippedNote}` };
    }
  }

  const saved = await saveIdentities(deps, target, available);
  if (saved.problem) return fail(saved.connected.length ? `Connected ${saved.connected.join(", ")}. ${saved.problem}` : saved.problem);
  return { returnTo: session.return_to, ok: true, platform, message: `Connected ${saved.connected.join(", ")}.${skippedNote}` };
}

// LinkedIn gives each app its own id for a member, so a profile connected through the
// original app comes back from the Community Management app under a new id. When the
// workspace has exactly one profile from the original app with the same name that this same
// person connected, that account is moved to the new id, so reconnecting updates it instead of
// adding (and billing) a second. Only their own: a name alone could match someone else's.
async function adoptOriginalProfile(deps: ConnectionDeps, workspaceId: string, actorId: string, identities: Identity[]) {
  const profile = identities.find((identity) => identity.capabilities.account_kind === "profile");
  if (!profile?.externalAccountId) return;
  const [already] = await deps.sql<{ id: string }>(
    `SELECT id FROM public.connected_accounts WHERE workspace_id = $1 AND platform = 'linkedin' AND external_account_id = $2`,
    [workspaceId, profile.externalAccountId],
  );
  if (already) return;
  const originals = await deps.sql<{ id: string }>(
    `SELECT id FROM public.connected_accounts
     WHERE workspace_id = $1 AND platform = 'linkedin' AND external_account_id NOT LIKE 'organization:%'
       AND 'openid' = ANY(scopes) AND display_name = $2 AND health <> 'disconnected' AND connected_by_actor_id = $3`,
    [workspaceId, profile.displayName, actorId],
  );
  if (originals.length !== 1) return;
  await deps.sql(
    `UPDATE public.connected_accounts SET external_account_id = $2, owner_external_id = $2 WHERE id = $1`,
    [originals[0].id, profile.externalAccountId],
  );
}

// What a waiting sign-in offers to connect. No tokens.
export type Choice = { external_id: string; name: string; kind: "profile" | "page" | null; avatar_url: string | null };
const choiceOf = (identity: Identity): Choice => ({
  external_id: identity.externalAccountId,
  name: identity.displayName,
  kind: identity.capabilities.account_kind ?? null,
  avatar_url: identity.avatarUrl ?? null,
});

type SaveTarget = { workspaceId: string; userId: string | null; actorId: string | null; profileId: string | null; platform: Platform };

// Saves signed-in accounts (new or reconnected) with their encrypted tokens. Stops at the
// plan's account limit and says so in `problem`, keeping what was saved before it.
async function saveIdentities(deps: ConnectionDeps, target: SaveTarget, identities: Identity[]): Promise<{ connected: string[]; problem?: string }> {
  const name = DISPLAY_NAMES[target.platform];
  const key = await importKey(deps.setting("CREDENTIAL_ENCRYPTION_KEY"));
  const connected: string[] = [];
  for (const identity of identities) {
    const externalId = identity.externalAccountId || `workspace:${target.workspaceId}`;
    const sealed = await seal(identity.tokens, key);
    // Reconnecting updates the same row instead of creating a duplicate.
    let event: { event_type: string } | undefined;
    try {
      [event] = await deps.sql<{ event_type: string }>(
        `WITH account AS (
           INSERT INTO public.connected_accounts
             (workspace_id, platform, external_account_id, owner_external_id, handle, display_name, avatar_url,
              scopes, capabilities, health, health_reason, connected_by_actor_id, last_verified_at, disconnected_at, profile_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, 'connected', NULL, $10, now(), NULL,
                   -- The chosen profile, unless it was deleted while the person was signing in.
                   (SELECT id FROM public.profiles WHERE id = $16::uuid AND workspace_id = $1))
           ON CONFLICT (workspace_id, platform, external_account_id) DO UPDATE SET
             owner_external_id = EXCLUDED.owner_external_id, handle = EXCLUDED.handle, display_name = EXCLUDED.display_name,
             avatar_url = EXCLUDED.avatar_url, avatar_synced_at = NULL, avatar_attempted_at = NULL, scopes = EXCLUDED.scopes, capabilities = EXCLUDED.capabilities,
             health = 'connected', health_reason = NULL, last_verified_at = now(), disconnected_at = NULL,
             -- Reconnecting keeps the account's profile; one chosen now applies only if it had none.
             profile_id = coalesce(connected_accounts.profile_id, EXCLUDED.profile_id)
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
         FROM account
         RETURNING event_type`,
        [
          target.workspaceId, target.platform, externalId, identity.ownerExternalId ?? null, identity.handle, identity.displayName,
          identity.avatarUrl ?? null, identity.scopes, JSON.stringify(identity.capabilities), target.actorId,
          sealed.encryptedPayload, sealed.initializationVector,
          dateText(identity.accessTokenExpiresAt), dateText(identity.refreshTokenExpiresAt),
          `Connected ${name} account ${identity.displayName}`,
          target.profileId,
        ],
      );
    } catch (error) {
      // Over the plan's account limit (the database refuses the new row).
      const overLimit = accountLimitMessage(error);
      if (!overLimit) throw error;
      if (connected.length) await deps.afterAccountsChanged?.(target.workspaceId).catch(() => null);
      return { connected, problem: overLimit };
    }
    // A step of the new-user funnel; reconnects don't count.
    if (event?.event_type === "account.connected") trackEvent("account_connected", { platform: target.platform, workspace_id: target.workspaceId }, target.userId ?? undefined);
    connected.push(identity.displayName);
  }
  await deps.afterAccountsChanged?.(target.workspaceId).catch(() => null);
  return { connected };
}

// Dates come back as text after a waiting sign-in is decrypted.
function dateText(value: Date | string | undefined) {
  if (!value) return null;
  return typeof value === "string" ? value : value.toISOString();
}

// The accounts a waiting sign-in offers, for the person who signed in.
export async function pendingChoices(deps: ConnectionDeps, caller: Caller, input: { pending_id?: unknown }) {
  // Only the person who signed in chooses; AIs never connect accounts.
  if (isAgentCaller(caller)) throw new ApiError(403, "Accounts are connected by a person in the Post Social web app. Use a connect link.");
  const pendingId = requireUuid(input.pending_id, "Sign-in");
  const [pending] = await deps.sql<{ platform: Platform; choices: Choice[]; workspace_id: string }>(
    `SELECT platform, choices, workspace_id FROM public.pending_connections WHERE id = $1 AND user_id = $2 AND expires_at > now()`,
    [pendingId, caller.userId],
  );
  if (!pending) throw new ApiError(404, "This sign-in expired. Connect the account again.");
  await membership(deps.sql, caller, pending.workspace_id, true, "Reviewers cannot connect accounts.");
  return { platform: pending.platform, workspace_id: pending.workspace_id, choices: pending.choices };
}

// Connects the accounts the person ticked from a waiting sign-in. Single use: the sign-in is
// removed whatever they chose, so its tokens never outlive the choice.
export async function chooseAccounts(deps: ConnectionDeps, caller: Caller, input: { pending_id?: unknown; external_ids?: unknown }) {
  // Only the person who signed in chooses; AIs never connect accounts.
  if (isAgentCaller(caller)) throw new ApiError(403, "Accounts are connected by a person in the Post Social web app. Use a connect link.");
  const pendingId = requireUuid(input.pending_id, "Sign-in");
  const wanted = Array.isArray(input.external_ids) ? input.external_ids.filter((id): id is string => typeof id === "string").slice(0, 200) : [];
  const [pending] = await deps.sql<{ workspace_id: string; user_id: string; platform: Platform; profile_id: string | null; return_to: string | null; encrypted_payload: string; initialization_vector: string }>(
    `DELETE FROM public.pending_connections WHERE id = $1 AND user_id = $2 AND expires_at > now()
     RETURNING workspace_id, user_id, platform, profile_id, return_to, encrypted_payload, initialization_vector`,
    [pendingId, caller.userId],
  );
  if (!pending) throw new ApiError(404, "This sign-in expired. Connect the account again.");
  const member = await membership(deps.sql, caller, pending.workspace_id, true, "Reviewers cannot connect accounts.");
  const name = DISPLAY_NAMES[pending.platform];
  if (!wanted.length) return { connected: [], return_to: pending.return_to, message: `No ${name} accounts were added.` };

  const identities = await open<Identity[]>({ encryptedPayload: pending.encrypted_payload, initializationVector: pending.initialization_vector }, await importKey(deps.setting("CREDENTIAL_ENCRYPTION_KEY")));
  const ticked = identities.filter((identity) => wanted.includes(identity.externalAccountId));
  // One social account belongs to one workspace; one connected elsewhere meanwhile is skipped.
  const chosen: Identity[] = [];
  const skipped: string[] = [];
  for (const identity of ticked) {
    const [elsewhere] = await deps.sql<{ id: string }>(
      `SELECT id FROM public.connected_accounts
       WHERE platform = $1 AND external_account_id = $2 AND workspace_id <> $3 AND health <> 'disconnected'`,
      [pending.platform, identity.externalAccountId, pending.workspace_id],
    );
    if (elsewhere) skipped.push(identity.displayName);
    else chosen.push(identity);
  }
  const skippedNote = skipped.length ? ` Skipped ${skipped.join(", ")}: already connected to another workspace.` : "";
  if (!chosen.length) return { connected: [], return_to: pending.return_to, message: `No ${name} accounts were added.${skippedNote}` };
  const saved = await saveIdentities(deps, {
    workspaceId: pending.workspace_id, userId: pending.user_id, actorId: member.actor_id ?? null, profileId: pending.profile_id, platform: pending.platform,
  }, chosen);
  const done = saved.connected.length ? `Connected ${saved.connected.join(", ")}.` : "";
  if (saved.problem) throw new ApiError(402, done ? `${done} ${saved.problem}` : saved.problem);
  return { connected: saved.connected, return_to: pending.return_to, message: `${done}${skippedNote}` };
}

type AccountRow = { id: string; workspace_id: string; platform: Platform; display_name: string; health: string; owner_external_id: string | null };

export async function disconnectAccount(deps: ConnectionDeps, caller: Caller, input: { account_id?: unknown }) {
  const accountId = requireUuid(input.account_id, "Account");
  const [account] = await deps.sql<AccountRow>(`SELECT id, workspace_id, platform, display_name, health, owner_external_id FROM public.connected_accounts WHERE id = $1`, [accountId]);
  if (!account) throw new ApiError(404, "That account was not found.");
  const member = await membership(deps.sql, caller, account.workspace_id, true, "Reviewers cannot disconnect accounts.").catch((error) => {
    if (error instanceof ApiError && error.status === 404) throw new ApiError(404, "That account was not found.");
    throw error;
  });
  if (account.health === "disconnected") return { account_id: accountId, status: "disconnected", revoked: "already_disconnected", cancelled_destinations: 0 };

  // Revoke at the platform first: after disconnect_account the token is gone.
  let revoked = "credential_missing";
  // A LinkedIn profile and its member's Pages share one sign-in: revoking it for one would
  // cut off the others, so it is only revoked with the last of them.
  const [sharing] = account.platform === "linkedin" && account.owner_external_id
    ? await deps.sql<{ id: string }>(
        `SELECT id FROM public.connected_accounts
         WHERE platform = 'linkedin' AND owner_external_id = $1 AND id <> $2 AND health <> 'disconnected' LIMIT 1`,
        [account.owner_external_id, accountId],
      )
    : [];
  const [credential] = sharing ? [] : await deps.sql<{ encrypted_payload: string; initialization_vector: string }>(
    `SELECT encrypted_payload, initialization_vector FROM public.credentials WHERE connected_account_id = $1`,
    [accountId],
  );
  if (sharing) revoked = "shared_with_other_accounts";
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
  await deps.afterAccountsChanged?.(account.workspace_id).catch(() => null);
  return { account_id: accountId, status: "disconnected", revoked, cancelled_destinations: Number(result?.cancelled ?? 0) };
}

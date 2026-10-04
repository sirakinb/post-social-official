// Meta's data-deletion and deauthorize callbacks. Meta signs each request with the app
// secret; Post Social has separate Meta apps for Facebook, Instagram and Threads, so a
// request is accepted if it verifies against any of their secrets.
import type { Sql } from "../access";
import { sha256Hex } from "./crypto";
import { readMetaSignedRequest, verifyMetaSignedRequest } from "./meta-signed-request";

export type MetaDeps = { sql: Sql; appSecrets: string[] };

async function verifiedUserId(request: Request, appSecrets: string[]) {
  const signed = await readMetaSignedRequest(request);
  for (const secret of appSecrets) {
    try {
      const payload = await verifyMetaSignedRequest(signed, secret);
      if (!payload.user_id) throw new Error("The request did not include a user id.");
      return String(payload.user_id);
    } catch {
      // try the next app's secret
    }
  }
  throw new Error("The signed request could not be verified.");
}

// Deletes everything Post Social holds for that Meta user and returns Meta's expected
// { url, confirmation_code } so they can check the status.
export async function handleDataDeletion(deps: MetaDeps, request: Request, statusBaseUrl: string) {
  const userId = await verifiedUserId(request, deps.appSecrets);
  const code = `meta_${crypto.randomUUID().replaceAll("-", "")}`;
  await deps.sql(`SELECT public.meta_delete_user_data($1, $2, $3)`, [userId, await sha256Hex(userId), code]);
  return { url: `${statusBaseUrl}?code=${encodeURIComponent(code)}`, confirmation_code: code };
}

// Meta deauthorize: the person removed the app. Disconnect their accounts (the tokens are
// already invalid, so there is nothing to revoke).
export async function handleDeauthorize(deps: MetaDeps, request: Request) {
  const userId = await verifiedUserId(request, deps.appSecrets);
  const accounts = await deps.sql<{ id: string; workspace_id: string; display_name: string }>(
    `SELECT id, workspace_id, display_name FROM public.connected_accounts
     WHERE platform IN ('facebook', 'instagram', 'threads') AND health <> 'disconnected'
       AND (owner_external_id = $1 OR external_account_id = $1)`,
    [userId],
  );
  for (const account of accounts) {
    await deps.sql(
      `WITH done AS (SELECT public.disconnect_account($1, 'Access was removed in Meta. Reconnect to continue.') AS cancelled)
       INSERT INTO public.audit_events (workspace_id, entry_point, event_type, entity_type, entity_id, summary)
       SELECT $2, 'system', 'account.deauthorized', 'account', $1, $3 FROM done`,
      [account.id, account.workspace_id, `${account.display_name} removed Post Social's access in Meta`],
    );
  }
  return { success: true, disconnected_accounts: accounts.length };
}

export async function deletionStatus(sql: Sql, code: string | null) {
  if (!code) return null;
  const [row] = await sql<{ status: string; removed_accounts: number; requested_at: string; completed_at: string | null }>(
    `SELECT status, removed_accounts, requested_at, completed_at FROM public.data_deletion_requests WHERE confirmation_code = $1`,
    [code],
  );
  return row ?? null;
}

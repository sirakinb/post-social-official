// Keeps our own copy of each connected account's profile picture. Platforms hand out
// signed picture links that stop working within days, so the picture is downloaded into
// storage and avatar_url points at our address instead. New and reconnected accounts are
// copied within minutes; every copy is refreshed weekly so a changed picture shows up.
import { createHash } from "node:crypto";
import type { Sql } from "../../backend/lib/access";
import { currentAvatarUrl, type Platform, type Settings } from "../../backend/lib/connections/platforms";
import type { R2 } from "../../backend/lib/media/r2";
import { accountToken } from "./credentials";
import type { Download } from "./safe-fetch";

export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

// Where the web app (and AI apps, with the site in front) load a saved picture. The version
// changes with the picture, so browsers never keep showing an old one.
export const avatarPath = (accountId: string, version: string) => `/api/avatars/${accountId}/${version}`;

export type AvatarDeps = {
  sql: Sql;
  r2: R2;
  setting: Settings;
  download: (url: string, signal: AbortSignal) => Promise<Download>;
  http?: typeof fetch;
  log?: (message: string, details?: Record<string, unknown>) => void;
};

type Due = { id: string; workspace_id: string; platform: Platform; external_account_id: string; display_name: string; avatar_url: string | null; avatar_key: string | null };

// Copies pictures for up to `max` accounts that have none yet or whose copy is a week old.
// A failure is retried after six hours; the last good copy stays meanwhile. Returns how
// many accounts were brought up to date.
export async function syncAvatars(deps: AvatarDeps, max = 10) {
  const due = await deps.sql<Due>(
    `UPDATE public.connected_accounts SET avatar_attempted_at = now()
     WHERE id IN (
       SELECT id FROM public.connected_accounts
       WHERE health <> 'disconnected'
         AND (avatar_synced_at IS NULL OR avatar_synced_at < now() - interval '7 days')
         AND (avatar_attempted_at IS NULL OR avatar_attempted_at < now() - interval '6 hours')
       ORDER BY avatar_synced_at NULLS FIRST LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, workspace_id, platform, external_account_id, display_name, avatar_url, avatar_key`,
    [max],
  );
  let synced = 0;
  for (const account of due) {
    try {
      if (await syncOne(deps, account)) synced++;
    } catch (error) {
      deps.log?.("profile picture not saved", { account: account.id, platform: account.platform, error: (error as Error).message.slice(0, 200) });
    }
  }
  return synced;
}

async function syncOne(deps: AvatarDeps, account: Due) {
  // Ask the platform for a fresh link; if that fails, the link saved at connect time is
  // still good for a few days after connecting.
  let source: string | null = null;
  try {
    const token = await accountToken({ sql: deps.sql, setting: deps.setting, http: deps.http }, { id: account.id, platform: account.platform, displayName: account.display_name });
    source = await currentAvatarUrl(account.platform, account.external_account_id, token, deps.http);
  } catch (error) {
    if (!isPlatformLink(account.avatar_url)) throw error;
  }
  source ??= isPlatformLink(account.avatar_url) ? account.avatar_url : null;
  if (!source) {
    // Nothing to show (e.g. YouTube): the app shows the platform's logo. Check again next week.
    await deps.sql(`UPDATE public.connected_accounts SET avatar_synced_at = now() WHERE id = $1`, [account.id]);
    return true;
  }

  const { bytes, type } = await fetchImage(deps, source);
  const version = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const key = `workspaces/${account.workspace_id}/avatars/${account.id}/${version}.${TYPES[type]}`;
  if (key !== account.avatar_key) await deps.r2.put(key, bytes, type);
  // Only if the account wasn't reconnected meanwhile (a reconnect clears avatar_synced_at
  // and is picked up again on the next run).
  const [updated] = await deps.sql<{ id: string }>(
    `UPDATE public.connected_accounts SET avatar_key = $2, avatar_url = $3, avatar_synced_at = now()
     WHERE id = $1 AND avatar_attempted_at IS NOT NULL AND health <> 'disconnected' RETURNING id`,
    [account.id, key, avatarPath(account.id, version)],
  );
  if (account.avatar_key && account.avatar_key !== key) {
    if (updated) await deps.r2.delete(account.avatar_key).catch(() => undefined);
  }
  return Boolean(updated);
}

// Our own address (already a copy) is not something to download again.
const isPlatformLink = (url: string | null): url is string => Boolean(url && url.startsWith("https://"));

async function fetchImage(deps: AvatarDeps, url: string) {
  const { response, close } = await deps.download(url, AbortSignal.timeout(30_000));
  try {
    const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!TYPES[type]) throw new Error(`The picture is not an image we keep (${type || "no type"}).`);
    if (Number(response.headers.get("content-length") ?? 0) > MAX_AVATAR_BYTES) throw new Error("The picture is too large.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of response.body ?? []) {
      size += chunk.length;
      if (size > MAX_AVATAR_BYTES) throw new Error("The picture is too large.");
      chunks.push(chunk);
    }
    if (!size) throw new Error("The picture is empty.");
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return { bytes, type };
  } finally {
    await close();
  }
}

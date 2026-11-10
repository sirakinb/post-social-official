// Shared by the publish-*.e2e.ts tests: posts to one connected test account through the
// REST API (a key made by the setup test), waits for the app to show it published, and
// checks the live link. Not one of Adzo's helpers (adzo-helpers.ts is replaced on update).
import { readFileSync } from 'node:fs';

export const KEY_FILE = '/tmp/ps-e2e-publish-key';

const base = () => (process.env.ADZO_APP_URL ?? '').replace(/\/+$/, '') + '/api/v1';

const bypass = (): Record<string, string> =>
  process.env.VERCEL_AUTOMATION_BYPASS_SECRET ? { 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET } : {};

export async function api(method: string, path: string, body?: unknown): Promise<any> {
  let key: string;
  try {
    key = readFileSync(KEY_FILE, 'utf8').trim();
  } catch {
    throw new Error('No API key from the setup test. Run the "social" setup first (sign in as the social test login and create the key).');
  }
  const res = await fetch(base() + path, {
    method,
    headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json', ...bypass() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} answered ${res.status}: ${data?.error?.message ?? JSON.stringify(data).slice(0, 300)}`);
  return data;
}

const NAMES: Record<string, string> = { bluesky: 'Bluesky', facebook: 'Facebook', instagram: 'Instagram', threads: 'Threads', linkedin: 'LinkedIn', x: 'X', tiktok: 'TikTok', youtube: 'YouTube' };

// The connected test account for a platform; fails plainly when it needs reconnecting.
export async function accountFor(platform: string): Promise<any> {
  const { accounts } = await api('GET', '/accounts?platform=' + platform);
  const name = NAMES[platform] ?? platform;
  const healthy = accounts.find((a: any) => a.health === 'healthy' || a.health === 'ok' || a.health === 'connected');
  if (!healthy) {
    const any = accounts[0];
    throw new Error(
      any
        ? `${name} connection needs reconnecting on staging (health: ${any.health}${any.health_reason ? ', ' + any.health_reason : ''}).`
        : `${name} is not connected in the staging test workspace. Connect it on staging first.`,
    );
  }
  return healthy;
}

// Uploads a file from adzo-tests/assets and waits until the app has checked it.
export async function uploadMedia(file: string, mime: string): Promise<string> {
  const bytes = readFileSync(new URL('../../assets/' + file, import.meta.url));
  const started = await api('POST', '/media/uploads', { file_name: file, mime_type: mime, size_bytes: bytes.length, single_part: true });
  const url = started.upload_url ?? started.url ?? started.parts?.[0]?.url ?? started.upload?.parts?.[0]?.url;
  const mediaId = started.media_id ?? started.id ?? started.media?.id;
  if (!url || !mediaId) throw new Error('Unexpected upload answer: ' + JSON.stringify(started).slice(0, 300));
  const put = await fetch(url, { method: 'PUT', headers: { 'content-type': mime }, body: bytes });
  if (!put.ok) throw new Error('Uploading the test file failed with ' + put.status);
  await api('POST', `/media/${mediaId}/complete`, {});
  const until = Date.now() + 120_000;
  while (Date.now() < until) {
    const m = await api('GET', '/media/' + mediaId);
    const status = m.status ?? m.media?.status;
    if (status === 'ready') return mediaId;
    if (status === 'failed' || status === 'rejected') throw new Error('The app rejected the test file: ' + JSON.stringify(m).slice(0, 300));
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error('The test file was not ready in 2 minutes.');
}

export type Published = { postId: string; liveUrl: string; destination: any };

// Publishes one post to one account right now and waits for its final state.
export async function publishNow(
  platform: string,
  post: { caption: string; options?: Record<string, unknown>; mediaIds?: string[]; timeoutMs?: number; requireLink?: boolean },
): Promise<Published> {
  const account = await accountFor(platform);
  const name = NAMES[platform] ?? platform;
  const created = await api('POST', '/posts', {
    caption: post.caption,
    ...(post.mediaIds?.length ? { media_ids: post.mediaIds } : {}),
    destinations: [{ account_id: account.id, ...(post.options ? { options: post.options } : {}) }],
    publish: 'now',
  });
  const postId: string = created.id;
  if (!postId) throw new Error('The app did not return a post id: ' + JSON.stringify(created).slice(0, 300));
  if (created.status === 'draft') throw new Error(`The app saved the ${name} post as a draft instead of sending it: ${created.next_step ?? ''}`);
  const until = Date.now() + (post.timeoutMs ?? 240_000);
  let latest: any = created;
  while (Date.now() < until) {
    latest = await api('GET', '/posts/' + postId);
    const d = (latest.destinations ?? [])[0];
    if (d && ['published', 'failed'].includes(String(d.status))) {
      if (d.status === 'failed') {
        const why = String(d.error ?? d.error_message ?? 'no reason given');
        if (/only publishes to approved test accounts/i.test(why)) throw new Error(`${name} test account is not on staging's publish allowlist (dev worker secret PUBLISH_ALLOWLIST): add its platform account id and redeploy the dev worker. App said: ${why}`);
        if (/reconnect|expired|token|unauthor|revoked|re-?auth/i.test(why)) throw new Error(`${name} connection needs reconnecting on staging (${why}).`);
        throw new Error(`${name} post failed: ${why}`);
      }
      if (!d.live_url && post.requireLink !== false) throw new Error(`${name} post shows published but has no live link.`);
      return { postId, liveUrl: d.live_url ? String(d.live_url) : '', destination: d };
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  throw new Error(`${name} post was still ${latest?.status} after ${Math.round((post.timeoutMs ?? 240_000) / 1000)} seconds.`);
}

// The live link must open (platforms that hide posts behind a login wall answer 200, 401, 403 or
// 999; only a missing post, 404 or 410, counts as not live).
export async function expectLinkOpens(url: string): Promise<number> {
  const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (compatible; PostSocialE2E)' } });
  if (res.status === 404 || res.status === 410 || res.status >= 500) throw new Error(`The live link ${url} answered ${res.status}.`);
  return res.status;
}

export const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

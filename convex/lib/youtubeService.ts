/**
 * Post Social — YouTube Integration Module
 * ==========================================
 * Framework-agnostic service layer for YouTube OAuth + Shorts upload.
 *
 * Registered Google Cloud config (already live — do not change without
 * updating the console at console.cloud.google.com/auth/clients?project=clippost-app):
 *   - GCP project: "Post Social" (project ID: clippost-app)
 *   - OAuth client: "Post Social Web"
 *   - Redirect URIs registered:
 *       https://www.postsocial.xyz/api/auth/youtube/callback   (prod)
 *       http://localhost:3333/api/auth/youtube/callback        (dev)
 *   - Scope: https://www.googleapis.com/auth/youtube.upload    (the ONLY scope —
 *     do not add more; each added sensitive scope re-triggers Google verification)
 *
 * Env vars expected (see .env.example):
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   GOOGLE_REDIRECT_URI        (env-appropriate: prod or localhost value above)
 *
 * No external deps — uses global fetch (Node 18+).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface YouTubeTokens {
  access_token: string;
  refresh_token?: string; // only returned on first consent (access_type=offline + prompt=consent)
  expires_in: number;     // seconds
  scope: string;
  token_type: 'Bearer';
}

export interface StoredYouTubeConnection {
  accessToken: string;        // encrypt at rest
  refreshToken: string;       // encrypt at rest — never expose to frontend
  accessTokenExpiresAt: Date; // now + expires_in, minus safety margin
  channelId?: string;
  channelTitle?: string;
}

export interface ShortUploadParams {
  title: string;          // include #Shorts for Shorts classification
  description?: string;
  tags?: string[];
  /** 'public' | 'unlisted' | 'private' */
  privacyStatus: 'public' | 'unlisted' | 'private';
  /** Raw video bytes. Vertical 9:16, ≤60s for Shorts. */
  videoBuffer: Buffer | Uint8Array;
  mimeType?: string;      // default video/mp4
}

export interface UploadResult {
  videoId: string;
  watchUrl: string;       // https://www.youtube.com/watch?v={id}
  /** Channel identity from the upload response — the only channel info the
   * upload-only scope can see. Use it to label the connection in the UI. */
  channelId?: string;
  channelTitle?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

const OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const UPLOAD_INIT_URL =
  'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';
const SCOPE = 'https://www.googleapis.com/auth/youtube.upload';

/** Refresh access tokens this many ms before actual expiry. */
const EXPIRY_SAFETY_MARGIN_MS = 5 * 60 * 1000;

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. OAuth — building the consent URL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the Google consent URL to redirect the user to.
 *
 * `state` MUST be an unguessable value you persist server-side (session or
 * short-lived DB row) and verify in the callback — this is the CSRF defense.
 *
 * access_type=offline + prompt=consent forces Google to return a refresh_token.
 * Without prompt=consent, re-authorizations return NO refresh token and the
 * connection silently breaks when the access token expires (~1h).
 */
export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env('GOOGLE_CLIENT_ID'),
    redirect_uri: env('GOOGLE_REDIRECT_URI'),
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'false', // do NOT accumulate scopes across grants
    state,
  });
  return `${OAUTH_AUTH_URL}?${params.toString()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. OAuth — exchanging the code (callback handler calls this)
// ─────────────────────────────────────────────────────────────────────────────

export async function exchangeCodeForTokens(code: string): Promise<YouTubeTokens> {
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env('GOOGLE_CLIENT_ID'),
      client_secret: env('GOOGLE_CLIENT_SECRET'),
      redirect_uri: env('GOOGLE_REDIRECT_URI'),
      grant_type: 'authorization_code',
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`YouTube token exchange failed (${res.status}): ${body}`);
  }

  const tokens = (await res.json()) as YouTubeTokens;

  if (!tokens.refresh_token) {
    // Happens if a previous grant exists and prompt=consent was somehow dropped.
    // Without a refresh token the connection dies in ~1 hour. Treat as failure
    // and have the user disconnect the app at myaccount.google.com/permissions
    // then reconnect.
    throw new Error(
      'Google did not return a refresh_token. User must revoke prior access and reconnect.'
    );
  }

  return tokens;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. OAuth — refreshing (call before any API request if near expiry)
// ─────────────────────────────────────────────────────────────────────────────

export async function refreshAccessToken(
  refreshToken: string
): Promise<{ accessToken: string; expiresAt: Date }> {
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env('GOOGLE_CLIENT_ID'),
      client_secret: env('GOOGLE_CLIENT_SECRET'),
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    // invalid_grant here almost always means the user revoked access in their
    // Google account. Surface as a "reconnect required" state in the UI,
    // don't retry in a loop.
    throw new Error(`YouTube token refresh failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  return {
    accessToken: data.access_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000 - EXPIRY_SAFETY_MARGIN_MS),
  };
}

/**
 * Convenience guard: returns a valid access token, refreshing if needed.
 * `persist` is called with fresh values when a refresh happens — wire it to
 * your DB update so the new token is saved.
 */
export async function ensureFreshAccessToken(
  conn: StoredYouTubeConnection,
  persist: (accessToken: string, expiresAt: Date) => Promise<void>
): Promise<string> {
  if (conn.accessTokenExpiresAt.getTime() > Date.now()) {
    return conn.accessToken;
  }
  const { accessToken, expiresAt } = await refreshAccessToken(conn.refreshToken);
  await persist(accessToken, expiresAt);
  return accessToken;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Upload — resumable protocol, Shorts-ready
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Upload a video via YouTube's resumable upload protocol.
 *
 * Shorts note: there is NO separate Shorts API. A Short is a normal upload
 * that is vertical (9:16), ≤60 seconds, with "#Shorts" in title/description.
 * YouTube classifies it automatically. This function appends #Shorts to the
 * title if absent — remove that behavior if uploading long-form.
 *
 * Quota note: each call consumes videos.insert quota. Verify the project's
 * actual per-day allowance in Cloud Console before high-volume use — do not
 * hardcode assumptions (allowances changed twice in 2025-2026).
 */
export async function uploadShort(
  accessToken: string,
  params: ShortUploadParams
): Promise<UploadResult> {
  const title = params.title.toLowerCase().includes('#shorts')
    ? params.title
    : `${params.title} #Shorts`;

  const metadata = {
    snippet: {
      title,
      description: params.description ?? '',
      tags: params.tags ?? [],
      categoryId: '22', // People & Blogs — safe default
    },
    status: {
      privacyStatus: params.privacyStatus,
      selfDeclaredMadeForKids: false,
    },
  };

  const videoBytes =
    params.videoBuffer instanceof Buffer ? params.videoBuffer : Buffer.from(params.videoBuffer);

  // Step 1: initiate the resumable session
  const initRes = await fetch(UPLOAD_INIT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(videoBytes.byteLength),
      'X-Upload-Content-Type': params.mimeType ?? 'video/mp4',
    },
    body: JSON.stringify(metadata),
  });

  if (!initRes.ok) {
    const body = await initRes.text();
    // 401 → token problem (refresh + retry once at the caller level)
    // 403 with quotaExceeded → daily quota gone; queue for after midnight PT
    throw new Error(`YouTube upload init failed (${initRes.status}): ${body}`);
  }

  const uploadUrl = initRes.headers.get('Location');
  if (!uploadUrl) throw new Error('YouTube upload init returned no Location header');

  // Step 2: PUT the bytes. Single-shot is fine for Shorts-sized files (<~100MB).
  // For larger files, chunk in multiples of 256 KiB with Content-Range headers
  // and resume on 308 responses.
  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': params.mimeType ?? 'video/mp4',
      'Content-Length': String(videoBytes.byteLength),
    },
    body: videoBytes,
  });

  if (!putRes.ok) {
    const body = await putRes.text();
    throw new Error(`YouTube upload PUT failed (${putRes.status}): ${body}`);
  }

  const video = (await putRes.json()) as {
    id: string;
    snippet?: { channelId?: string; channelTitle?: string };
  };
  return {
    videoId: video.id,
    watchUrl: `https://www.youtube.com/watch?v=${video.id}`,
    channelId: video.snippet?.channelId,
    channelTitle: video.snippet?.channelTitle,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Disconnect — revoke on Google's side, then delete stored tokens
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Revoke the grant at Google. Call this from your disconnect flow BEFORE
 * deleting the stored tokens, so the privacy-policy "how users delete their
 * data" story is real. Failure here is non-fatal (user may have already
 * revoked from their Google account) — still delete local tokens.
 */
export async function revokeAccess(refreshToken: string): Promise<void> {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  }).catch(() => {
    /* best-effort */
  });
}

// Shared shapes for publishing. Each platform adapter is a resumable step function: it reads
// the job's checkpoint to see how far it got, does the next step, saves progress BEFORE any
// call that cannot be undone, and returns either "published" or "check again later".
import type { Platform } from "../../../backend/lib/connections/platforms";
import type { DestinationOptions, MediaFacts } from "../../../backend/lib/publishing/validate";

export class PublishError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryable = false,
    public retryAt?: Date,
    // The account's access was rejected: flag it so the person reconnects.
    public reconnect = false,
  ) {
    super(message);
  }
}

// Saving null removes a key.
export type Checkpoint = Record<string, unknown> & { publish_started_at?: string | null };

export type PublishMedia = MediaFacts & { storage_key: string; url: string };

export type Bundle = {
  jobId: string;
  workspaceId: string;
  postId: string;
  destinationId: string;
  platform: Platform;
  options: DestinationOptions;
  caption: string;
  account: { id: string; externalId: string; handle: string; displayName: string; scopes: string[]; capabilities: Record<string, unknown> };
  media: PublishMedia[];
};

export type StepResult =
  // profile: account details the platform revealed while posting (e.g. YouTube's channel
  // name, which the upload-only permission cannot read at sign-in).
  | { kind: "published"; platformId?: string; liveUrl?: string; note?: string; profile?: { displayName: string } }
  | { kind: "wait"; afterMs: number; message?: string };

export type StepContext = {
  bundle: Bundle;
  checkpoint: Checkpoint;
  // Saves progress; merged into the checkpoint. Throws if this worker lost the job.
  save: (patch: Checkpoint) => Promise<void>;
  token: () => Promise<string>;
  http: typeof fetch;
  // Counts one call against a platform limit; throws a retryable PublishError when full.
  reserve: (operation: string, limit: number, windowSeconds: number) => Promise<void>;
  // Keeps the job's lease alive during long uploads.
  renewLease: () => Promise<void>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

export type Adapter = (ctx: StepContext) => Promise<StepResult>;

const TRANSIENT_META_CODES = new Set([1, 2, 4, 17, 32, 341, 368, 613, 80001, 80002]);

// Reads a platform JSON response and turns errors into PublishErrors with the right
// retry behaviour.
export async function platformJson(response: Response, what: string): Promise<Record<string, any>> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const text = await response.text();
  let body: Record<string, any> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    // keep empty
  }
  const error = body.error as { code?: number | string; message?: string; error_user_msg?: string; is_transient?: boolean } | undefined;
  const failed = !response.ok || (error && error.code !== "ok");
  if (!failed) return body;
  const code = typeof error?.code === "number" ? error.code : undefined;
  const message = error?.error_user_msg ?? error?.message ?? `${what} failed (${response.status}).`;
  if (response.status === 401 || code === 190 || error?.code === "access_token_invalid") {
    throw new PublishError("access_expired", `${what} was refused because the account's access expired. Reconnect the account and try again.`, false, undefined, true);
  }
  const transient = response.status === 429 || response.status >= 500 || error?.is_transient === true || (code !== undefined && TRANSIENT_META_CODES.has(code)) || error?.code === "rate_limit_exceeded";
  throw new PublishError(code !== undefined ? `meta_${code}` : typeof error?.code === "string" ? error.code : `http_${response.status}`, `${what} failed: ${message}`, transient);
}

export const MINUTE = 60_000;

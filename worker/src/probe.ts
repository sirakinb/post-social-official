// Reads a stored file's type, dimensions and duration with mediainfo.js, fetching only the
// byte ranges it needs through a short-lived signed link.
import { createRequire } from "node:module";
import path from "node:path";
import mediaInfoFactory from "mediainfo.js";
import type { R2 } from "../../backend/lib/media/r2";
import { interpretProbe, signatureProblem, type MediaInfoResult, type ProbeOutcome } from "../../backend/lib/media/probe-result";
import type { MediaType } from "../../backend/lib/media/rules";

// mediainfo.js ships its WebAssembly file next to its Node build in node_modules.
function wasmPath() {
  const require = createRequire(import.meta.url);
  return path.join(path.dirname(require.resolve("mediainfo.js")), "..", "MediaInfoModule.wasm");
}

const WINDOW_BYTES = 4 * 1024 * 1024;
const READ_TIMEOUT_MS = 30_000;
const PROBE_TIMEOUT_MS = 5 * 60_000;

// Serves mediainfo's many small reads from 4 MB windows, so a file costs a handful of
// requests instead of dozens. Every request has a time limit and two retries, and the whole
// probe has a deadline: a stalled connection must never hold a worker slot (the same slots
// publish posts).
export function rangeReader(
  url: string,
  sizeBytes: number,
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal; readTimeoutMs?: number; windowBytes?: number } = {},
) {
  const { fetchImpl = fetch, signal, readTimeoutMs = READ_TIMEOUT_MS, windowBytes = WINDOW_BYTES } = options;
  let window: { start: number; bytes: Uint8Array } | null = null;

  async function fetchRange(start: number, end: number) {
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted();
      try {
        const timeout = AbortSignal.timeout(readTimeoutMs);
        const response = await fetchImpl(url, {
          headers: { Range: `bytes=${start}-${end - 1}` },
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
        if (!response.ok) throw new Error(`Reading the stored file failed (${response.status})`);
        // 200 instead of 206: the server ignored the range and sent the whole file.
        return { start: response.status === 206 ? start : 0, bytes: new Uint8Array(await response.arrayBuffer()) };
      } catch (error) {
        if (signal?.aborted || attempt >= 2) throw error;
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }

  return async (chunkSize: number, offset: number) => {
    if (chunkSize <= 0 || offset >= sizeBytes) return new Uint8Array();
    const end = Math.min(offset + chunkSize, sizeBytes);
    if (!window || offset < window.start || end > window.start + window.bytes.length) {
      window = await fetchRange(offset, Math.min(offset + Math.max(chunkSize, windowBytes), sizeBytes));
    }
    return window.bytes.slice(offset - window.start, end - window.start);
  };
}

// One analysis at a time per worker: mediainfo can use a few hundred MB on a damaged or
// hostile file, and the worker's slots also publish posts.
let running: Promise<unknown> = Promise.resolve();

export async function probeStoredFile(r2: R2, key: string, sizeBytes: number, expected: MediaType | null): Promise<ProbeOutcome> {
  const url = await r2.presignGet(key, 30 * 60); // covers waiting for a turn plus the deadline
  const problem = signatureProblem(await rangeReader(url, sizeBytes)(16, 0));
  if (problem) return { ok: false, reason: problem };

  const turn = running.then(async () => {
    // The deadline starts when this file's turn comes, not while it waits.
    const deadline = AbortSignal.timeout(PROBE_TIMEOUT_MS);
    const read = rangeReader(url, sizeBytes, { signal: deadline });
    const mediainfo = await mediaInfoFactory({ format: "object", locateFile: () => wasmPath() });
    try {
      const result = await Promise.race([
        mediainfo.analyzeData(sizeBytes, read),
        new Promise<never>((_, reject) => {
          deadline.throwIfAborted();
          deadline.addEventListener("abort", () => reject(new Error("Checking the file took too long.")), { once: true });
        }),
      ]);
      return interpretProbe(result as unknown as MediaInfoResult, expected);
    } finally {
      mediainfo.close();
    }
  });
  running = turn.catch(() => undefined);
  return turn;
}

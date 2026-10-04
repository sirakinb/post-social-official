// Browser upload of one file in parts to presigned URLs, with limited parallelism, a retry
// per part and overall progress. The PUT itself is injected so this runs in tests.

export type PresignedPart = { part_number: number; url: string };
export type UploadedPart = { part_number: number; etag: string };

export type PutPart = (
  url: string,
  body: Blob,
  onProgress: (loadedBytes: number) => void,
  signal: AbortSignal,
) => Promise<string>; // resolves with the part's ETag

export async function uploadParts(options: {
  file: Blob;
  partSize: number;
  parts: PresignedPart[];
  putPart: PutPart;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  concurrency?: number;
  retries?: number;
}): Promise<UploadedPart[]> {
  const { file, partSize, parts, putPart, onProgress, concurrency = 4, retries = 2 } = options;
  // Internal controller: cancelled by the caller, or by us when a part fails for good so the
  // other in-flight parts stop instead of racing the server-side cancel.
  const controller = new AbortController();
  const signal = controller.signal;
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener("abort", () => controller.abort(), { once: true });
  const loaded = new Map<number, number>();
  const report = () => {
    let total = 0;
    for (const bytes of loaded.values()) total += bytes;
    onProgress?.(file.size ? Math.min(total / file.size, 1) : 1);
  };

  const results: UploadedPart[] = [];
  const queue = [...parts].sort((a, b) => a.part_number - b.part_number);

  async function runOne(part: PresignedPart) {
    const start = (part.part_number - 1) * partSize;
    const body = file.slice(start, Math.min(start + partSize, file.size));
    for (let attempt = 0; ; attempt++) {
      if (signal.aborted) throw new DOMException("Upload cancelled", "AbortError");
      try {
        const etag = await putPart(part.url, body, (bytes) => {
          loaded.set(part.part_number, bytes);
          report();
        }, signal);
        loaded.set(part.part_number, body.size);
        report();
        return { part_number: part.part_number, etag };
      } catch (error) {
        loaded.set(part.part_number, 0);
        report();
        if (signal.aborted || attempt >= retries) throw error;
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
      }
    }
  }

  async function worker() {
    for (let part = queue.shift(); part; part = queue.shift()) results.push(await runOne(part));
  }
  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, parts.length) }, worker));
  } catch (error) {
    controller.abort();
    throw error;
  }
  return results.sort((a, b) => a.part_number - b.part_number);
}

// XMLHttpRequest gives upload progress, which fetch does not yet do reliably.
export const xhrPutPart: PutPart = (url, body, onProgress, signal) =>
  new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    request.upload.onprogress = (event) => onProgress(event.loaded);
    request.onload = () => {
      const etag = request.getResponseHeader("ETag");
      if (request.status >= 200 && request.status < 300 && etag) resolve(etag);
      else reject(new Error(`Part upload failed (${request.status})`));
    };
    request.onerror = () => reject(new Error("Network error while uploading"));
    signal.addEventListener("abort", () => request.abort(), { once: true });
    request.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    request.send(body);
  });

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export function formatDuration(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds)) return null;
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

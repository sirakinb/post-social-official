export const MAX_MEDIA_BYTES = 500 * 1024 * 1024;

export type UploadProgressEvent = {
  percent: number;
  loaded: number;
  total: number;
};

export interface UploadFileOptions {
  uploadUrl: string;
  file: File;
  onProgress?: (event: UploadProgressEvent) => void;
  timeoutMs?: number;
}

export interface UploadFileResult {
  storageId: string;
}

export function assertFilesWithinSizeLimit(files: File[]): void {
  for (const file of files) {
    if (file.size > MAX_MEDIA_BYTES) {
      throw new Error(`${file.name} is larger than the 500 MB limit.`);
    }
  }
}

export function uploadFile({
  uploadUrl,
  file,
  onProgress,
  timeoutMs = 10 * 60 * 1000,
}: UploadFileOptions): Promise<UploadFileResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;

    const settle = (action: () => void) => {
      if (settled) return;
      settled = true;
      action();
    };

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && onProgress) {
        const loaded = event.loaded;
        const total = event.total;
        const percent = total > 0 ? Math.round((loaded / total) * 100) : 0;
        onProgress({ percent, loaded, total });
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        settle(() => reject(new Error(`Upload failed with status ${xhr.status}.`)));
        return;
      }

      let body: unknown;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        settle(() => reject(new Error("Upload response was not valid JSON.")));
        return;
      }

      if (!body || typeof body !== "object") {
        settle(() => reject(new Error("Upload response did not include a storage id.")));
        return;
      }

      const storageId = (body as { storageId?: unknown }).storageId;
      if (typeof storageId !== "string" || storageId.length === 0) {
        settle(() => reject(new Error("Upload response did not include a storage id.")));
        return;
      }

      settle(() => resolve({ storageId }));
    });

    xhr.addEventListener("error", () => {
      settle(() => reject(new Error("Upload failed because of a network error.")));
    });

    xhr.addEventListener("abort", () => {
      settle(() => reject(new Error("Upload was cancelled.")));
    });

    xhr.addEventListener("timeout", () => {
      settle(() => reject(new Error("Upload timed out after 10 minutes.")));
    });

    xhr.open("POST", uploadUrl);
    xhr.timeout = timeoutMs;
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.send(file);
  });
}

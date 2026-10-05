// `postsocial upload --file ./video.mp4`: sends a local file straight to storage in parts
// (no size cap beyond your plan's storage), then waits until Post Social has checked it.
import { open, stat } from "node:fs/promises";
import path from "node:path";
import type { Credentials } from "./auth";
import { callOperation, type Operation } from "./api";

const TYPES: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".mp4": "video/mp4", ".mov": "video/quicktime" };

export function mimeFor(file: string) {
  const type = TYPES[path.extname(file).toLowerCase()];
  if (!type) throw new Error(`Post Social takes JPEG, PNG, WebP, MP4 and MOV files; ${path.basename(file)} is not one of them.`);
  return type;
}

type UploadStart = { media_id: string; part_size: number; parts: Array<{ part_number: number; url: string }> };
type Media = { id: string; status: string; failure_reason?: string | null };

export async function uploadFile(
  credentials: Credentials,
  ops: Operation[],
  file: string,
  options: { name?: string; wait?: boolean; progress?: (sent: number, total: number) => void; http?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {},
) {
  const http = options.http ?? fetch;
  const op = (id: string) => {
    const found = ops.find((o) => o.operationId === id);
    if (!found) throw new Error(`This Post Social server has no ${id} command.`);
    return found;
  };
  const size = (await stat(file)).size;
  const started = (await callOperation(credentials, op("start_media_upload"), { file_name: options.name ?? path.basename(file), mime_type: mimeFor(file), size_bytes: size }, { http })) as UploadStart;

  const handle = await open(file, "r");
  const parts: Array<{ part_number: number; etag: string }> = [];
  let sent = 0;
  try {
    for (const part of started.parts) {
      const offset = (part.part_number - 1) * started.part_size;
      const length = Math.min(started.part_size, size - offset);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, offset);
      // The link is signed for this part's exact size; fetch sends it from the buffer.
      const response = await http(part.url, { method: "PUT", body: buffer });
      if (!response.ok) throw new Error(`Uploading part ${part.part_number} failed (${response.status}). Try again.`);
      parts.push({ part_number: part.part_number, etag: response.headers.get("etag") ?? "" });
      sent += length;
      options.progress?.(sent, size);
    }
  } finally {
    await handle.close();
  }
  let media = (await callOperation(credentials, op("finish_media_upload"), { media_id: started.media_id, parts }, { http })) as Media;
  if (options.wait === false) return media;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  for (let i = 0; i < 120 && media.status === "processing"; i++) {
    await sleep(2000);
    media = (await callOperation(credentials, op("get_media"), { media_id: media.id }, { http })) as Media;
  }
  return media;
}

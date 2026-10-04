// Reads a stored file's type, dimensions and duration with mediainfo.js, fetching only the
// byte ranges it needs through a short-lived signed link.
import { createRequire } from "node:module";
import path from "node:path";
import mediaInfoFactory from "mediainfo.js";
import type { R2 } from "../../backend/lib/media/r2";
import { interpretProbe, type MediaInfoResult, type ProbeOutcome } from "../../backend/lib/media/probe-result";
import type { MediaType } from "../../backend/lib/media/rules";

// mediainfo.js ships its WebAssembly file next to its Node build in node_modules.
function wasmPath() {
  const require = createRequire(import.meta.url);
  return path.join(path.dirname(require.resolve("mediainfo.js")), "..", "MediaInfoModule.wasm");
}

export async function probeStoredFile(r2: R2, key: string, sizeBytes: number, expected: MediaType | null): Promise<ProbeOutcome> {
  const url = await r2.presignGet(key, 15 * 60);
  const mediainfo = await mediaInfoFactory({ format: "object", locateFile: () => wasmPath() });
  try {
    const result = await mediainfo.analyzeData(sizeBytes, async (chunkSize, offset) => {
      if (chunkSize <= 0 || offset >= sizeBytes) return new Uint8Array();
      const end = Math.min(offset + chunkSize, sizeBytes) - 1;
      const response = await fetch(url, { headers: { Range: `bytes=${offset}-${end}` } });
      if (!response.ok) throw new Error(`Reading the stored file failed (${response.status})`);
      return new Uint8Array(await response.arrayBuffer());
    });
    return interpretProbe(result as unknown as MediaInfoResult, expected);
  } finally {
    mediainfo.close();
  }
}

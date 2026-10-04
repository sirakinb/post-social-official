// @vitest-environment node
//
// Runs the worker's job handler against the dev branch and the dev R2 bucket:
// `npm run test:db`. Skipped by `npm test`. Imports fetch two small public sample files.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSql } from "../lib/insforge-admin";
import { createR2, type R2 } from "../lib/media/r2";
import { createAccount, resolveTarget, type AccountResult } from "../../scripts/lib/accounts";
import { expireUnusedMedia, removeOrphanedFiles } from "../../worker/src/cleanup";
import { runNextJob, type WorkerDeps } from "../../worker/src/jobs";
import { probeStoredFile } from "../../worker/src/probe";
import { safeFetch } from "../../worker/src/safe-fetch";
import { api, uniqueSuffix } from "./dev-backend";

const enabled = process.env.INSFORGE_INTEGRATION === "1";
const repoRoot = path.resolve(__dirname, "../..");

function devSecret(name: string) {
  const out = execFileSync(path.join(repoRoot, "scripts/insforge-env.sh"), ["dev", "secrets", "get", name, "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return (JSON.parse(out.slice(out.indexOf("{"))) as { value: string }).value;
}

// A valid 64x48 PNG, built by hand so the test needs no fixture files.
function makePng(width: number, height: number) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const typed = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    typed.copy(out, 4);
    out.writeUInt32BE(crc(typed), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const rows = Buffer.concat(Array.from({ length: height }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 200)])));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

describe.skipIf(!enabled)("media worker on the dev backend", () => {
  const target = enabled ? resolveTarget("dev", repoRoot) : null!;
  const suffix = uniqueSuffix();
  const password = `Worker-${suffix}-9`;
  let owner: AccountResult;
  let token = "";
  let r2: R2;
  let deps: WorkerDeps;

  const media = (body: Record<string, unknown>) => api<Record<string, unknown>>(target.baseUrl, token, "POST", "/functions/media", body);

  async function upload(fileName: string, mimeType: string, bytes: Uint8Array) {
    const start = await media({ action: "create_upload", workspace_id: owner.workspaceId, file_name: fileName, mime_type: mimeType, size_bytes: bytes.length });
    expect(start.status, JSON.stringify(start.body)).toBe(200);
    const partSize = start.body.part_size as number;
    const parts = [];
    for (const part of start.body.parts as Array<{ part_number: number; url: string }>) {
      const put = await fetch(part.url, { method: "PUT", body: bytes.slice((part.part_number - 1) * partSize, part.part_number * partSize) });
      parts.push({ part_number: part.part_number, etag: put.headers.get("etag") });
    }
    const done = await media({ action: "complete_upload", media_id: start.body.media_id, parts });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    return String(start.body.media_id);
  }

  const get = async (id: string) => (await media({ action: "get", media_id: id })).body;

  // The deployed dev worker may pick a job up before this test does, so run jobs here too
  // and wait until the media item settles either way.
  async function settled(id: string) {
    for (let i = 0; i < 90; i++) {
      await runNextJob(deps);
      const current = await get(id);
      if (!["processing", "uploading"].includes(String(current.status))) return current;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error(`media ${id} did not finish processing`);
  }

  beforeAll(async () => {
    r2 = createR2({
      accountId: devSecret("R2_ACCOUNT_ID"),
      bucket: devSecret("R2_BUCKET"),
      accessKeyId: devSecret("R2_ACCESS_KEY_ID"),
      secretAccessKey: devSecret("R2_SECRET_ACCESS_KEY"),
    });
    const sql = createSql(target.baseUrl, target.adminKey);
    deps = {
      sql,
      r2,
      probe: (key, size, expected) => probeStoredFile(r2, key, size, expected),
      download: (url, signal) => safeFetch(url, { signal }),
      log: () => undefined,
    };
    owner = await createAccount(target, {
      role: "owner",
      email: `worker-owner-${suffix}@postsocial.test`,
      displayName: "Worker Owner",
      password,
      workspaceName: `Worker Test ${suffix}`,
    });
    const session = await api<{ accessToken: string }>(target.baseUrl, "", "POST", "/api/auth/sessions?client_type=server", {
      email: `worker-owner-${suffix}@postsocial.test`,
      password,
    });
    token = session.body.accessToken;
  }, 180_000);

  afterAll(async () => {
    if (!owner) return;
    await api(target.baseUrl, target.adminKey, "DELETE", `/api/database/records/workspaces?id=eq.${owner.workspaceId}`);
    await api(target.baseUrl, target.adminKey, "DELETE", "/api/auth/users", { userIds: [owner.userId] });
    // The orphan sweep removes this workspace's files now that the workspace is gone.
    await removeOrphanedFiles(deps.sql, r2);
    const leftovers = await r2.list(`workspaces/${owner.workspaceId}/`);
    expect(leftovers.keys).toEqual([]);
  }, 180_000);

  it("reads an uploaded image's dimensions and marks it ready", async () => {
    const id = await upload("square.png", "image/png", makePng(64, 48));
    expect(await settled(id)).toMatchObject({ status: "ready", media_type: "image", mime_type: "image/png", width: 64, height: 48 });
  }, 120_000);

  it("fails a file that only pretends to be a video, with a plain reason, and removes it from storage", async () => {
    const id = await upload("fake.mp4", "video/mp4", new Uint8Array(5000).fill(9));
    const result = await settled(id);
    expect(result).toMatchObject({ status: "failed" });
    expect(String(result.failure_reason)).toMatch(/not a supported video or image/);
  }, 120_000);

  it("imports a video from a public link and reads its length and size", async () => {
    const started = await media({ action: "import", workspace_id: owner.workspaceId, url: "https://www.w3schools.com/html/mov_bbb.mp4" });
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    const result = await settled(String(started.body.id));
    expect(result, JSON.stringify(result)).toMatchObject({ status: "ready", media_type: "video", mime_type: "video/mp4", width: 320, height: 176 });
    expect(Number(result.duration_seconds)).toBeGreaterThan(5);
    expect(Number(result.size_bytes)).toBeGreaterThan(100_000);
  }, 180_000);

  it("fails an import whose link is a web page, not media", async () => {
    const started = await media({ action: "import", workspace_id: owner.workspaceId, url: "https://example.com/" });
    const result = await settled(String(started.body.id));
    expect(result).toMatchObject({ status: "failed" });
    expect(String(result.failure_reason)).toMatch(/not a supported video or image/);
  }, 120_000);

  it("expires unused media after the retention period and keeps the record", async () => {
    const id = await upload("old.png", "image/png", makePng(8, 8));
    await settled(id);
    await deps.sql(`UPDATE public.media_assets SET last_used_at = now() - interval '31 days' WHERE id = $1`, [id]);
    await expireUnusedMedia(deps.sql, r2, 30);
    const result = await get(id);
    expect(result).toMatchObject({ status: "expired" });
    const [row] = await deps.sql<{ storage_key: string }>(`SELECT storage_key FROM public.media_assets WHERE id = $1`, [id]);
    expect(await r2.head(row.storage_key)).toBeNull();
  }, 120_000);
});

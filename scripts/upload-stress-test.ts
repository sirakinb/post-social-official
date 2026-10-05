// Upload stress test against DEV only: one big video, several videos at once from different
// AI keys, and the refusals (too big, not really a video). It goes through the public API
// the way the CLI does: start, PUT each part to storage, finish, then wait for the check.
//
// The test videos are a real short MP4 padded with an MP4 "free" box up to the wanted
// size, so the checker reads them as valid without needing ffmpeg. Everything is deleted
// at the end: the rows right away, the stored files by the worker's orphan sweep.
//
//   npx esbuild scripts/upload-stress-test.ts --bundle --platform=node --format=esm --outfile=.build/upload-stress-test.mjs \
//     && node .build/upload-stress-test.mjs <api base url> [big MB = 500] [small MB = 100] [how many at once = 5]
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createSql } from "../backend/lib/insforge-admin";
import { keyActions } from "../backend/lib/api/keys";
import { createAccount, resolveTarget, type AccountResult } from "./lib/accounts";

const [apiBase, bigArg = "500", smallArg = "100", countArg = "5"] = process.argv.slice(2);
if (!apiBase) {
  console.error("Usage: node .build/upload-stress-test.mjs <api base url> [big MB] [small MB] [how many at once]");
  process.exit(1);
}
const MB = 1024 * 1024;
const BIG = Number(bigArg) * MB;
const SMALL = Number(smallArg) * MB;
const COUNT = Number(countArg);
const repoRoot = path.resolve(import.meta.dirname, "..");
const target = resolveTarget("dev", repoRoot);
// Dev only: the API address must belong to the dev project (e.g. <dev id>.function2.insforge.app).
const devProject = new URL(target.baseUrl).hostname.split(".")[0];
if (!new URL(apiBase).hostname.startsWith(`${devProject}.`)) {
  console.error(`${apiBase} is not the dev API (expected https://${devProject}.function2.insforge.app/api).`);
  process.exit(1);
}
const sql = createSql(target.baseUrl, target.adminKey);
const suffix = randomBytes(3).toString("hex");
const sample = readFileSync(path.join(repoRoot, "submission/meta/threads-submission-captioned-small.mp4"));

// A virtual file: the sample MP4, then one "free" box filling the rest with zeros.
type Source = { size: number; bytes: (start: number, end: number) => Buffer };
function paddedVideo(size: number): Source {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(size - sample.length, 0);
  header.write("free", 4, "ascii");
  const head = Buffer.concat([sample, header]);
  return { size, bytes: (start, end) => Buffer.concat([head.subarray(Math.min(start, head.length), Math.min(end, head.length)), Buffer.alloc(Math.max(0, end - Math.max(start, head.length)))]) };
}
function noise(size: number): Source {
  const block = randomBytes(MB);
  return { size, bytes: (start, end) => Buffer.concat(Array.from({ length: Math.ceil((end - start) / MB) + 1 }, () => block)).subarray(0, end - start) };
}

type Media = { id: string; status: string; failure_reason?: string | null; duration_seconds?: number | null };
type Start = { media_id: string; part_size: number; parts: Array<{ part_number: number; url: string }> };

async function api<T>(key: string, method: string, route: string, body?: unknown): Promise<{ status: number; body: T }> {
  const response = await fetch(`${apiBase}${route}`, { method, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: (await response.json().catch(() => null)) as T };
}

const seconds = (since: number) => (performance.now() - since) / 1000;

// One upload, parts four at a time like the web app, each part retried twice.
async function upload(key: string, name: string, source: Source) {
  const started = performance.now();
  const start = await api<Start>(key, "POST", "/v1/media/uploads", { file_name: name, mime_type: "video/mp4", size_bytes: source.size });
  if (start.status !== 200 && start.status !== 201) throw new Error(`${name}: start refused (${start.status}) ${JSON.stringify(start.body)}`);
  const { media_id, part_size, parts } = start.body;
  const queue = [...parts];
  const done: Array<{ part_number: number; etag: string }> = [];
  let retries = 0;
  const worker = async () => {
    for (let part = queue.shift(); part; part = queue.shift()) {
      const from = (part.part_number - 1) * part_size;
      const body = source.bytes(from, Math.min(from + part_size, source.size));
      for (let attempt = 0; ; attempt++) {
        const response = await fetch(part.url, { method: "PUT", body: new Uint8Array(body) }).catch(() => null);
        if (response?.ok) {
          done.push({ part_number: part.part_number, etag: response.headers.get("etag") ?? "" });
          break;
        }
        if (attempt >= 2) throw new Error(`${name}: part ${part.part_number} failed (${response?.status ?? "network"})`);
        retries++;
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  const sent = seconds(started);
  const finish = await api<Media>(key, "POST", `/v1/media/${media_id}/complete`, { parts: done.sort((a, b) => a.part_number - b.part_number) });
  if (finish.status !== 200) throw new Error(`${name}: finish refused (${finish.status}) ${JSON.stringify(finish.body)}`);
  const checking = performance.now();
  let media = finish.body;
  for (let i = 0; i < 180 && media.status === "processing"; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    media = (await api<Media>(key, "GET", `/v1/media/${media_id}`)).body;
  }
  return { name, media, sent, checked: seconds(checking), parts: parts.length, retries, mbps: (source.size * 8) / MB / sent };
}

function line(r: Awaited<ReturnType<typeof upload>>, size: number) {
  return `${r.name.padEnd(22)} ${String(size / MB).padStart(5)} MB in ${r.parts} parts: sent in ${r.sent.toFixed(1)}s (${r.mbps.toFixed(0)} Mbit/s, ${r.retries} retries), checked in ${r.checked.toFixed(1)}s -> ${r.media.status}${r.media.failure_reason ? ` (${r.media.failure_reason})` : ""}`;
}

let owner: AccountResult | null = null;
let failed = false;
async function cleanUp() {
  const done = owner;
  owner = null;
  if (!done) return;
  await sql(`DELETE FROM public.workspaces WHERE id = $1`, [done.workspaceId]);
  await fetch(`${target.baseUrl}/api/auth/users`, { method: "DELETE", headers: { Authorization: `Bearer ${target.adminKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ userIds: [done.userId] }) });
  console.log("\nCleaned up the test workspace and account; the worker's orphan sweep removes the stored files within 6 hours.");
}
// Stopped with Ctrl-C: still remove what was created.
process.once("SIGINT", () => void cleanUp().finally(() => process.exit(130)));
const expect = (ok: boolean, what: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}`);
  if (!ok) failed = true;
};

try {
  owner = await createAccount(target, { role: "owner", email: `upload-${suffix}@postsocial.test`, displayName: "Upload Test", password: `Upload-${randomBytes(8).toString("hex")}-1`, workspaceName: `Upload Test ${suffix}` });
  const ws = owner.workspaceId;
  const person = { userId: owner.userId, displayName: "Upload Test", entryPoint: "ui" as const };
  const keys: string[] = [];
  for (let i = 0; i < Math.max(COUNT, 1); i++) keys.push((await keyActions.create(sql, person, { workspace_id: ws, name: `Uploader ${i + 1}`, mode: "live" })).key);
  console.log(`Upload stress test on dev, workspace ${ws}\n`);

  // A: one big video.
  const big = await upload(keys[0], "big.mp4", paddedVideo(BIG));
  console.log(line(big, BIG));
  expect(big.media.status === "ready" && (big.media.duration_seconds ?? 0) > 0, `A  ${BIG / MB} MB video is ready with a length`);

  // B: several videos at the same time, one per key.
  const startedB = performance.now();
  const many = await Promise.all(keys.slice(0, COUNT).map((key, i) => upload(key, `parallel-${i + 1}.mp4`, paddedVideo(SMALL))));
  for (const r of many) console.log(line(r, SMALL));
  console.log(`   all ${COUNT} done in ${seconds(startedB).toFixed(1)}s`);
  expect(many.every((r) => r.media.status === "ready"), `B  ${COUNT} x ${SMALL / MB} MB at once are all ready`);

  // C: refusals.
  const tooBig = await api(keys[0], "POST", "/v1/media/uploads", { file_name: "huge.mp4", mime_type: "video/mp4", size_bytes: 1024 * MB + 1 });
  expect(tooBig.status === 400, `C  over 1 GB refused before any upload (${tooBig.status})`);
  const fake = await upload(keys[0], "not-a-video.mp4", noise(20 * MB));
  console.log(line(fake, 20 * MB));
  if (fake.media.status === "processing") {
    const jobs = await sql(`SELECT state, attempt_count, max_attempts, last_error, next_attempt_at FROM public.media_jobs WHERE media_asset_id = $1`, [fake.media.id]);
    console.log("   its check job:", JSON.stringify(jobs));
  }
  expect(fake.media.status === "failed" && !!fake.media.failure_reason, "C  random bytes sent as MP4 end up failed with a reason");

  const [stored] = await sql<{ ready: number; uploading: number }>(
    `SELECT count(*) FILTER (WHERE status = 'ready')::int AS ready, count(*) FILTER (WHERE status = 'uploading')::int AS uploading FROM public.media_assets WHERE workspace_id = $1`,
    [ws],
  );
  expect(stored.ready === COUNT + 1 && stored.uploading === 0, `   library has ${stored.ready} ready and ${stored.uploading} stuck uploads`);
} catch (error) {
  failed = true;
  console.error(`FAIL  ${error instanceof Error ? error.message : error}`);
} finally {
  await cleanUp();
  process.exitCode = failed ? 1 : 0;
}

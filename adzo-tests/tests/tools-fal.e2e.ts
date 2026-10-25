import { test } from '@e2e-dev/web';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

// Tool, not a check: runs fal.ai jobs (voiceover and music for the product videos,
// sirakinb/post-social-videos) so the fal key stays a project secret. Reads
// /data/home/videos-work/fal/jobs.json ([{ id, endpoint, input }]), saves each result's audio
// to out/<id>.<ext> and its JSON to out/<id>.json, then moves the jobs file aside.
// Does nothing without the jobs file.
const DIR = '/data/home/videos-work/fal';
type Job = { id: string; endpoint: string; input: Record<string, unknown> };

test('tools: run fal jobs', { timeout: 600_000 }, async () => {
  const file = `${DIR}/jobs.json`;
  if (!existsSync(file)) return;
  const key = process.env.E2E_SECRET_FAL_KEY;
  if (!key) throw new Error('fal key missing');
  const jobs = JSON.parse(readFileSync(file, 'utf8')) as Job[];
  mkdirSync(`${DIR}/out`, { recursive: true });
  const log: Array<Record<string, unknown>> = [];
  await Promise.all(jobs.map(async (job) => {
    const res = await fetch(`https://fal.run/${job.endpoint}`, { method: 'POST', headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(job.input) });
    const entry: Record<string, unknown> = { id: job.id, status: res.status };
    const body = await res.text();
    if (!res.ok) { entry.error = body.slice(0, 2000); log.push(entry); return; }
    const data = JSON.parse(body) as { audio?: { url?: string; content_type?: string } };
    writeFileSync(`${DIR}/out/${job.id}.json`, body);
    const url = data.audio?.url;
    if (url) {
      const ext = (data.audio?.content_type ?? '').includes('wav') ? 'wav' : 'mp3';
      const audio = await fetch(url);
      writeFileSync(`${DIR}/out/${job.id}.${ext}`, Buffer.from(await audio.arrayBuffer()));
      entry.file = `${job.id}.${ext}`;
    }
    log.push(entry);
  }));
  writeFileSync(`${DIR}/log-${Date.now()}.json`, JSON.stringify(log, null, 2));
  renameSync(file, `${DIR}/jobs.done-${Date.now()}.json`);
});

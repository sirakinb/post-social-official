import { test } from '@e2e-dev/web';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

// Tool, not a check: runs ElevenLabs jobs for the product videos (sirakinb/post-social-videos)
// so the API key stays a project secret. Reads /data/home/videos-work/audio/jobs.json, writes
// each result next to it and moves the jobs file to jobs.done.json. Does nothing without it.
const DIR = '/data/home/videos-work/audio';
type Job =
  | { id: string; kind: 'voices' | 'user' | 'models' }
  | { id: string; kind: 'tts'; voice_id: string; text: string; model_id?: string; voice_settings?: Record<string, unknown>; seed?: number; previous_text?: string; next_text?: string }
  | { id: string; kind: 'music'; prompt?: string; composition_plan?: unknown; music_length_ms?: number; model_id?: string };

test('tools: run ElevenLabs jobs', async () => {
  const file = `${DIR}/jobs.json`;
  if (!existsSync(file)) return;
  const key = process.env.E2E_SECRET_ELEVENLABS_API_KEY;
  if (!key) throw new Error('ELEVENLABS key missing');
  const jobs = JSON.parse(readFileSync(file, 'utf8')) as Job[];
  mkdirSync(`${DIR}/out`, { recursive: true });
  const log: Array<Record<string, unknown>> = [];
  for (const job of jobs) {
    let url = 'https://api.elevenlabs.io';
    let init: RequestInit = { headers: { 'xi-api-key': key } };
    let ext = 'json';
    if (job.kind === 'voices') url += '/v2/voices?page_size=100';
    else if (job.kind === 'user') url += '/v1/user/subscription';
    else if (job.kind === 'models') url += '/v1/models';
    else if (job.kind === 'tts') {
      const { id: _id, kind: _k, voice_id, ...body } = job;
      url += `/v1/text-to-speech/${voice_id}/with-timestamps?output_format=mp3_44100_192`;
      init = { method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify({ model_id: 'eleven_multilingual_v2', ...body }) };
    } else if (job.kind === 'music') {
      const { id: _id, kind: _k, ...body } = job;
      url += '/v1/music?output_format=mp3_44100_192';
      init = { method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
      ext = 'mp3';
    }
    const res = await fetch(url, init);
    const entry: Record<string, unknown> = { id: job.id, kind: job.kind, status: res.status };
    if (!res.ok) {
      entry.error = (await res.text()).slice(0, 2000);
    } else if (ext === 'mp3') {
      writeFileSync(`${DIR}/out/${job.id}.mp3`, Buffer.from(await res.arrayBuffer()));
    } else if (job.kind === 'tts') {
      const body = (await res.json()) as { audio_base64: string; alignment: unknown; normalized_alignment: unknown };
      writeFileSync(`${DIR}/out/${job.id}.mp3`, Buffer.from(body.audio_base64, 'base64'));
      writeFileSync(`${DIR}/out/${job.id}.align.json`, JSON.stringify({ alignment: body.alignment, normalized: body.normalized_alignment }));
    } else {
      writeFileSync(`${DIR}/out/${job.id}.json`, await res.text());
    }
    log.push(entry);
  }
  writeFileSync(`${DIR}/log-${Date.now()}.json`, JSON.stringify(log, null, 2));
  renameSync(file, `${DIR}/jobs.done-${Date.now()}.json`);
});

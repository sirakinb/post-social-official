// Load test against DEV only: many AI agents (live API keys) reading, writing, scheduling
// and calling MCP at once, plus a check that the per-key limit holds. Publishing stays
// paused and the accounts are fake, so nothing reaches a platform. Everything it creates
// is deleted at the end.
//
//   npx esbuild scripts/load-test.ts --bundle --platform=node --format=esm --outfile=.build/load-test.mjs \
//     && node .build/load-test.mjs <api base url, e.g. https://<app>.function2.insforge.app/api>
import { randomBytes } from "node:crypto";
import path from "node:path";
import { createSql } from "../backend/lib/insforge-admin";
import { keyActions } from "../backend/lib/api/keys";
import { createAccount, resolveTarget, type AccountResult } from "./lib/accounts";

const apiBase = process.argv[2];
if (!apiBase) {
  console.error("Usage: node .build/load-test.mjs <api base url>");
  process.exit(1);
}
const target = resolveTarget("dev", path.resolve(import.meta.dirname, ".."));
const sql = createSql(target.baseUrl, target.adminKey);
const suffix = randomBytes(3).toString("hex");
const AGENTS = 10;

type Sample = { ms: number; status: number };
const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
function report(name: string, samples: Sample[], seconds: number) {
  const ms = samples.map((s) => s.ms).sort((a, b) => a - b);
  const byStatus: Record<number, number> = {};
  for (const s of samples) byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
  console.log(
    `${name.padEnd(28)} ${String(samples.length).padStart(4)} requests in ${seconds.toFixed(1)}s (${(samples.length / seconds).toFixed(1)}/s)  ` +
      `p50 ${pct(ms, 50)}ms  p95 ${pct(ms, 95)}ms  p99 ${pct(ms, 99)}ms  max ${ms.at(-1)}ms  status ${JSON.stringify(byStatus)}`,
  );
}

async function timed(fn: () => Promise<Response>): Promise<Sample> {
  const started = performance.now();
  const response = await fn().catch(() => null);
  await response?.text().catch(() => "");
  return { ms: Math.round(performance.now() - started), status: response?.status ?? 0 };
}

// Runs `perAgent` calls for each agent, all agents in parallel, each agent one call at a time.
async function phase(name: string, perAgent: number, call: (agent: number, i: number) => Promise<Response>) {
  const started = performance.now();
  const samples = (await Promise.all(Array.from({ length: AGENTS }, async (_, agent) => {
    const out: Sample[] = [];
    for (let i = 0; i < perAgent; i++) out.push(await timed(() => call(agent, i)));
    return out;
  }))).flat();
  report(name, samples, (performance.now() - started) / 1000);
  return samples;
}

const pause = (s: number) => new Promise((r) => setTimeout(r, s * 1000));
let owner: AccountResult | null = null;

try {
  owner = await createAccount(target, { role: "owner", email: `load-${suffix}@postsocial.test`, displayName: "Load Test", password: `Load-${randomBytes(8).toString("hex")}-1`, workspaceName: `Load Test ${suffix}` });
  const ws = owner.workspaceId;
  await sql(`UPDATE public.workspaces SET publishing_paused = true WHERE id = $1`, [ws]);
  const [account] = await sql<{ id: string }>(
    `INSERT INTO public.connected_accounts (workspace_id, platform, external_account_id, handle, display_name, capabilities, health, approval_policy_override)
     VALUES ($1, 'threads', $2, 'load', 'Load Test', '{}', 'connected', 'autonomous') RETURNING id`,
    [ws, `load-threads-${suffix}`],
  );
  const person = { userId: owner.userId, displayName: "Load Test", entryPoint: "ui" as const };
  const keys: string[] = [];
  for (let i = 0; i < AGENTS; i++) keys.push((await keyActions.create(sql, person, { workspace_id: ws, name: `Agent ${i + 1}`, mode: "live" })).key);
  const auth = (agent: number) => ({ Authorization: `Bearer ${keys[agent]}`, "Content-Type": "application/json" });
  console.log(`Load test on dev: ${AGENTS} agents, workspace ${ws} (publishing paused)\n`);

  // A: reading. 10 agents x 30 = 300 requests.
  await phase("A  list posts (read)", 30, (a) => fetch(`${apiBase}/v1/posts?limit=20`, { headers: auth(a) }));
  await pause(30);
  // B: writing drafts. 10 x 20 = 200.
  await phase("B  create drafts (write)", 20, (a, i) =>
    fetch(`${apiBase}/v1/posts`, { method: "POST", headers: auth(a), body: JSON.stringify({ draft: true, caption: `Load draft ${a}-${i} ${suffix}`, destinations: [{ account_id: account.id, options: { media_type: "text" } }] }) }),
  );
  await pause(30);
  // C: scheduling (creates publish jobs). 10 x 10 = 100.
  const at = new Date(Date.now() + 24 * 3600_000).toISOString();
  await phase("C  schedule posts (queue)", 10, (a, i) =>
    fetch(`${apiBase}/v1/posts`, { method: "POST", headers: auth(a), body: JSON.stringify({ caption: `Load scheduled ${a}-${i} ${suffix}`, scheduled_at: at, destinations: [{ account_id: account.id, options: { media_type: "text" } }] }) }),
  );
  await pause(30);
  // D: MCP, the way AI apps call it. 10 x 20 = 200.
  await phase("D  MCP list_posts", 20, (a, i) =>
    fetch(`${apiBase}/mcp`, { method: "POST", headers: auth(a), body: JSON.stringify({ jsonrpc: "2.0", id: i, method: "tools/call", params: { name: "list_posts", arguments: { limit: 10 } } }) }),
  );
  await pause(60);
  // E: one key over its limit (120/min): expect the extra calls to be refused with 429.
  const started = performance.now();
  const burst: Sample[] = [];
  for (let i = 0; i < 135; i++) burst.push(await timed(() => fetch(`${apiBase}/v1/me`, { headers: auth(0) })));
  report("E  one key, 135 quick calls", burst, (performance.now() - started) / 1000);

  const [counts] = await sql<{ posts: number; jobs: number }>(
    `SELECT (SELECT count(*) FROM public.posts WHERE workspace_id = $1)::int AS posts, (SELECT count(*) FROM public.publish_jobs WHERE workspace_id = $1)::int AS jobs`,
    [ws],
  );
  console.log(`\nCreated ${counts.posts} posts and ${counts.jobs} publish jobs (paused, never sent).`);
} finally {
  if (owner) {
    await sql(`DELETE FROM public.workspaces WHERE id = $1`, [owner.workspaceId]);
    await fetch(`${target.baseUrl}/api/auth/users`, { method: "DELETE", headers: { Authorization: `Bearer ${target.adminKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ userIds: [owner.userId] }) });
    console.log("Cleaned up the load-test workspace and account.");
  }
}

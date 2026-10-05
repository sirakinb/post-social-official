// A demo workspace on DEV for screenshots and product videos: a small pottery studio with
// five connected accounts, Claude and ChatGPT connected, and posts in every state. Nothing
// here talks to a social platform: the accounts are fake and publishing stays paused.
//
//   npx esbuild scripts/seed-demo-workspace.ts --bundle --platform=node --format=esm --outfile=.build/seed-demo.mjs \
//     && node .build/seed-demo.mjs <images dir> <credentials file>
//
// The images dir holds wheel.jpg, latte.jpg, mugs.jpg, market.jpg and kiln.jpg. The sign-in
// for the demo account is written to <credentials file> (mode 600), never printed.
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createSql } from "../backend/lib/insforge-admin";
import { createR2 } from "../backend/lib/media/r2";
import { createAccount, resolveTarget } from "./lib/accounts";

const repoRoot = path.resolve(import.meta.dirname, "..");
const [imagesDir, credentialsFile] = process.argv.slice(2);
if (!imagesDir || !credentialsFile) {
  console.error("Usage: node .build/seed-demo.mjs <images dir> <credentials file>");
  process.exit(1);
}

const target = resolveTarget("dev", repoRoot);
const sql = createSql(target.baseUrl, target.adminKey);
const devSecret = (name: string) => {
  const out = execFileSync(path.join(repoRoot, "scripts/insforge-env.sh"), ["dev", "secrets", "get", name, "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return (JSON.parse(out.slice(out.indexOf("{"))) as { value: string }).value;
};
const r2 = createR2({ accountId: devSecret("R2_ACCOUNT_ID"), bucket: devSecret("R2_BUCKET"), accessKeyId: devSecret("R2_ACCESS_KEY_ID"), secretAccessKey: devSecret("R2_SECRET_ACCESS_KEY") });

const suffix = randomBytes(3).toString("hex");
const email = `demo-${suffix}@postsocial.test`;
const password = `Demo-${randomBytes(9).toString("base64url")}-7`;
const account = await createAccount(target, { role: "owner", email, displayName: "Maya Okafor", password, workspaceName: `Lantern Studio ${suffix}` });
writeFileSync(credentialsFile, JSON.stringify({ email, password, workspaceId: account.workspaceId, userId: account.userId }, null, 2), { mode: 0o600 });
const ws = account.workspaceId;

await sql(`UPDATE public.workspaces SET name = 'Lantern Studio', publishing_paused = true WHERE id = $1`, [ws]);
const [person] = await sql<{ id: string }>(`SELECT id FROM public.actors WHERE workspace_id = $1 AND kind = 'user'`, [ws]);

const now = Date.now();
const at = (hours: number) => new Date(now + hours * 3600_000).toISOString();
// Hours from now until a clock time `days` from today (local time), so the demo reads like
// a real week: "Tue 9:00 AM" rather than "Tue 5:09 AM".
const clock = (days: number, hour: number, minute = 0) => {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return (d.getTime() - now) / 3600_000;
};

// Connected accounts (fake ids; publishing is paused, so nothing ever reaches a platform).
const accounts: Record<string, string> = {};
for (const [platform, handle, name] of [
  ["tiktok", "lanternstudio", "Lantern Studio"],
  ["instagram", "lantern.studio", "Lantern Studio"],
  ["facebook", "lanternstudio", "Lantern Studio"],
  ["threads", "lantern.studio", "Lantern Studio"],
  ["youtube", "lanternstudio", "Lantern Studio"],
] as const) {
  const [row] = await sql<{ id: string }>(
    `INSERT INTO public.connected_accounts (workspace_id, platform, external_account_id, handle, display_name, capabilities, health, connected_by_actor_id, last_verified_at, created_at)
     VALUES ($1, $2, $3, $4, $5, '{}', 'connected', $6, now(), $7) RETURNING id`,
    [ws, platform, `demo-${platform}-${suffix}`, handle, name, person.id, at(-24 * 9)],
  );
  accounts[platform] = row.id;
}

// Claude and ChatGPT, connected the way an AI app signs in.
const aiActors: Record<string, string> = {};
for (const [name, app] of [["Claude", "claude"], ["ChatGPT", "chatgpt"]] as const) {
  const [client] = await sql<{ id: string }>(`INSERT INTO public.oauth_clients (client_id, client_name, redirect_uris) VALUES ($1, $2, $3) RETURNING id`, [`demo-${app}-${suffix}`, name, [`https://${app}.example/callback`]]);
  const [grant] = await sql<{ id: string }>(
    `INSERT INTO public.oauth_grants (workspace_id, user_id, oauth_client_id, label, scopes, last_used_at, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [ws, account.userId, client.id, name, ["posts:write", "media:write"], at(-1), at(-24 * 8)],
  );
  const [actor] = await sql<{ id: string }>(`INSERT INTO public.actors (workspace_id, kind, oauth_grant_id, display_name) VALUES ($1, 'oauth_grant', $2, $3) RETURNING id`, [ws, grant.id, name]);
  aiActors[app] = actor.id;
}

// Media: images go up as themselves; "videos" carry their still frame as the poster.
const media: Record<string, string> = {};
for (const [key, file, type, width, height, seconds] of [
  ["wheel", "wheel.jpg", "video", 1080, 1920, 34],
  ["latte", "latte.jpg", "video", 1080, 1920, 21],
  ["kiln", "kiln.jpg", "video", 1080, 1920, 47],
  ["mugs", "mugs.jpg", "image", 928, 1152, null],
  ["market", "market.jpg", "image", 928, 1152, null],
] as const) {
  const id = randomUUID();
  const dir = `workspaces/${ws}/media/${id}`;
  const body = new Uint8Array(readFileSync(path.join(imagesDir, file)));
  const storageKey = type === "video" ? `${dir}/${key}.mp4` : `${dir}/${file}`;
  await r2.put(type === "video" ? `${dir}/poster.jpg` : storageKey, body, "image/jpeg");
  await sql(
    `INSERT INTO public.media_assets (id, workspace_id, uploaded_by_actor_id, storage_key, file_name, display_name, mime_type, media_type, size_bytes, width, height, duration_seconds, status, poster_key, poster_attempted_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'ready', $13, now(), $14)`,
    [id, ws, person.id, storageKey, type === "video" ? `${key}.mp4` : file, null, type === "video" ? "video/mp4" : "image/jpeg", type, body.byteLength * (type === "video" ? 40 : 1), width, height, seconds, type === "video" ? `${dir}/poster.jpg` : null, at(-24 * 6)],
  );
  media[key] = id;
}

type Dest = { platform: keyof typeof accounts; status: string; error?: string };
async function post(p: { caption: string; status: string; when: number; actor: string; entry: "ui" | "mcp"; media: string; dests: Dest[] }) {
  const [row] = await sql<{ id: string }>(
    `INSERT INTO public.posts (workspace_id, actor_id, entry_point, caption, status, scheduled_at, effective_approval_policy, requested_at, created_at) VALUES ($1, $2, $3, $4, $5, $6, 'autonomous', $7, $7) RETURNING id`,
    [ws, p.actor, p.entry, p.caption, p.status, at(p.when), at(Math.min(p.when, 0) - 2)],
  );
  await sql(`INSERT INTO public.post_media (post_id, media_asset_id, workspace_id, position) VALUES ($1, $2, $3, 0)`, [row.id, media[p.media], ws]);
  for (const d of p.dests) {
    const [dest] = await sql<{ id: string }>(
      `INSERT INTO public.destinations (workspace_id, post_id, connected_account_id, platform, actor_id, status, effective_approval_policy, live_url, error_code, error_message, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'autonomous', $7, $8, $9, $10) RETURNING id`,
      [ws, row.id, accounts[d.platform], d.platform, p.actor, d.status, d.status === "published" ? `https://example.com/${d.platform}/${suffix}` : null, d.error ? "platform_rejected" : null, d.error ?? null, at(Math.min(p.when, 0))],
    );
    if (d.status === "published") await sql(`INSERT INTO public.usage_events (workspace_id, actor_id, event_type, quantity, occurred_at, connected_account_id, platform) VALUES ($1, $2, 'post_published', 1, $3, $4, $5)`, [ws, p.actor, at(p.when), accounts[d.platform], d.platform]);
    if (d.status === "published") await audit(p.when + 0.05, null, "worker", "destination.published", "destination", dest.id, `Published to Lantern Studio on ${NAMES[d.platform]}`);
    if (d.status === "failed") await audit(p.when + 0.05, null, "worker", "destination.failed", "destination", dest.id, `Could not publish to Lantern Studio on ${NAMES[d.platform]}`);
  }
  return row.id;
}

const NAMES: Record<string, string> = { tiktok: "TikTok", instagram: "Instagram", facebook: "Facebook", threads: "Threads", youtube: "YouTube" };
async function audit(hours: number, actor: string | null, entry: string, type: string, entity: string, entityId: string | null, summary: string) {
  await sql(`INSERT INTO public.audit_events (workspace_id, actor_id, entry_point, event_type, entity_type, entity_id, summary, occurred_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [ws, actor, entry, type, entity, entityId, summary, at(hours)]);
}

for (const [platform, hours] of [["tiktok", -24 * 9], ["instagram", -24 * 9 + 0.1], ["facebook", -24 * 9 + 0.2], ["threads", -24 * 9 + 0.3], ["youtube", -24 * 9 + 0.4]] as const) {
  await audit(hours, person.id, "ui", "account.connected", "account", accounts[platform], `Connected ${NAMES[platform]} account Lantern Studio`);
}
await audit(-24 * 8, person.id, "ui", "oauth_grant.created", "oauth_grant", null, "Connected Claude");
await audit(-24 * 8 + 1, person.id, "ui", "oauth_grant.created", "oauth_grant", null, "Connected ChatGPT");

// Already out.
await post({ caption: "Plum & cream. Six new mugs, one quiet morning.", status: "published", when: clock(-2, 11), actor: person.id, entry: "ui", media: "mugs", dests: [{ platform: "instagram", status: "published" }, { platform: "threads", status: "published" }, { platform: "facebook", status: "published" }] });
await post({ caption: "Fresh out of the kiln 🔥 Our autumn glazes are finally here.", status: "published", when: clock(-1, 18, 30), actor: aiActors.claude, entry: "mcp", media: "kiln", dests: [{ platform: "tiktok", status: "published" }, { platform: "instagram", status: "published" }, { platform: "youtube", status: "published" }] });
await post({ caption: "See you at the Saturday market! Table 14, under the string lights.", status: "partially_published", when: clock(-1, 20), actor: aiActors.chatgpt, entry: "mcp", media: "market", dests: [{ platform: "facebook", status: "published" }, { platform: "instagram", status: "failed", error: "Instagram needs this photo to be at most 4:5 tall. Crop it and try again." }] });

// Coming up this week, from Maya, Claude and ChatGPT.
const upcoming: Array<{ caption: string; when: number; who: "claude" | "chatgpt" | "person"; media: string; platforms: Array<keyof typeof accounts> }> = [
  { caption: "Slow mornings at the wheel. Every bowl starts like this.", when: clock(0, 12, 30), who: "claude", media: "wheel", platforms: ["tiktok", "instagram", "threads"] },
  { caption: "Our speckled cups, now at Ember Coffee on 5th ☕", when: clock(1, 9), who: "chatgpt", media: "latte", platforms: ["instagram", "facebook", "tiktok"] },
  { caption: "Last call: the holiday pre-order closes Sunday. Link in bio.", when: clock(2, 12), who: "person", media: "market", platforms: ["instagram", "threads", "facebook"] },
  { caption: "Glaze test day. Which one should we make next?", when: clock(3, 18), who: "claude", media: "kiln", platforms: ["youtube", "tiktok"] },
  { caption: "Restocked: plum mugs are back in the shop.", when: clock(4, 10), who: "chatgpt", media: "mugs", platforms: ["instagram", "facebook", "threads"] },
  { caption: "Open studio this Saturday. Come throw a bowl with us.", when: clock(5, 9, 30), who: "claude", media: "wheel", platforms: ["tiktok", "instagram", "youtube"] },
  { caption: "Sunday pour-over in our newest cups.", when: clock(6, 17), who: "person", media: "latte", platforms: ["threads", "instagram"] },
];
let minutesAgo = 50;
for (const u of upcoming) {
  const actor = u.who === "person" ? person.id : aiActors[u.who];
  const id = await post({ caption: u.caption, status: "scheduled", when: u.when, actor, entry: u.who === "person" ? "ui" : "mcp", media: u.media, dests: u.platforms.map((platform) => ({ platform, status: "scheduled" })) });
  const list = u.platforms.map((p) => NAMES[p]);
  await audit(-minutesAgo / 60, actor, u.who === "person" ? "ui" : "mcp", "post.submitted", "post", id, `Scheduled a post for ${list.slice(0, -1).join(", ")} and ${list.at(-1)}`);
  minutesAgo -= 6;
}

console.log(`Demo workspace ready on dev: ${ws}. Sign-in saved to ${credentialsFile}.`);

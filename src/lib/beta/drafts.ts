// Drafts are saved but not scheduled, so the calendar leaves them out. The Drafts page
// lists them, including ones an AI app or API key saved, so nothing is lost. Read with the
// person's own session (row-level security).
import type { ActorKind } from "@/components/beta/marks";
import { SAMPLE_DRAFT } from "../../../backend/lib/sample-draft";
import { whoDid } from "./logs";

type Client = Awaited<ReturnType<typeof import("@/lib/insforge/server").insforgeServerClient>>;

export const DRAFTS_LIMIT = 200;

type Actor = { kind: ActorKind; display_name: string; client_name?: string | null };

export type DraftRow = {
  id: string;
  caption: string;
  // A time can be set on a draft; it still waits until someone schedules it.
  scheduled_at: string | null;
  updated_at: string;
  entry_point: string;
  actors: Actor | null;
  destinations: Array<{ platform: string; connected_accounts: { display_name: string } | null }>;
  post_media: Array<{ position: number; media_assets: { id: string; media_type: "image" | "video"; status: string } | null }>;
};

// Who saved a draft and from where, e.g. "Saved by Claude Code via MCP". AI apps go by
// the name they gave when they connected, as in the logs.
export function savedBy(actor: Actor | null, via: string, caption?: string): { kind: ActorKind; name: string; text: string } | null {
  if (!actor) return null;
  // The example draft every new workspace gets is from Post Social, not from the person.
  if (caption === SAMPLE_DRAFT) return { kind: "system", name: "Post Social", text: "Example from Post Social" };
  const who = whoDid(actor, null);
  const from = via === "mcp" ? " via MCP" : via === "api" ? " via the API" : "";
  return { kind: who.actorKind, name: who.actorName, text: `Saved by ${who.actorName}${from}` };
}

// The draft's first picture or video, for its thumbnail.
export function firstMedia(row: DraftRow) {
  return [...row.post_media].sort((a, b) => a.position - b.position)[0]?.media_assets ?? null;
}

const select = (actor: string) =>
  `id, caption, scheduled_at, updated_at, entry_point, actors(${actor}), destinations(platform, connected_accounts(display_name)), post_media(position, media_assets(id, media_type, status))`;

// Newest first. The app name (client_name) is newer than the rest: if a database doesn't
// have it yet, drafts still load, with key and app names as before.
export async function loadDrafts(client: Client, workspaceId: string) {
  const query = (actor: string) =>
    client.database.from("posts").select(select(actor)).eq("workspace_id", workspaceId).eq("status", "draft").order("updated_at", { ascending: false }).limit(DRAFTS_LIMIT + 1);
  let { data, error } = await query("kind, display_name, client_name");
  if (error) ({ data, error } = await query("kind, display_name"));
  if (error) {
    console.error("drafts: reading failed", error);
    return { rows: [] as DraftRow[], hasMore: false, failed: true };
  }
  const rows = (data ?? []) as unknown as DraftRow[];
  return { rows: rows.slice(0, DRAFTS_LIMIT), hasMore: rows.length > DRAFTS_LIMIT, failed: false };
}

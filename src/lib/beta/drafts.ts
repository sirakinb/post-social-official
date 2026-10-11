// Drafts are saved but not scheduled, so the calendar leaves them out. The Drafts page
// lists them, including ones an AI app or API key saved, so nothing is lost.

export type DraftRow = {
  id: string;
  caption: string;
  updated_at: string;
  entry_point: string;
  actors: { kind: string; display_name: string } | null;
  destinations: Array<{ platform: string; connected_accounts: { display_name: string } | null }>;
  post_media: Array<{ position: number; media_assets: { id: string; media_type: "image" | "video"; status: string } | null }>;
};

// Who saved a draft and from where, e.g. "Saved by Claude via MCP".
export function savedBy(actor: DraftRow["actors"], via: string): string {
  if (!actor) return "Saved";
  const from = via === "mcp" ? " via MCP" : via === "api" ? " via the API" : "";
  return `Saved by ${actor.display_name}${from}`;
}

// The draft's first picture or video, for its thumbnail.
export function firstMedia(row: DraftRow) {
  return [...row.post_media].sort((a, b) => a.position - b.position)[0]?.media_assets ?? null;
}

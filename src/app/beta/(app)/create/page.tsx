import { loadViewer } from "@/lib/beta/workspace";
import type { ComposerAccount, ComposerMedia, Platform, PlatformChoice } from "@/lib/beta/composer-model";
import { getMediaLinks } from "./actions";
import { Composer, type EditingPost } from "./composer";

export const metadata = { title: "Create · Post Social" };

const PLATFORMS: Platform[] = ["instagram", "facebook", "threads", "youtube", "tiktok"];
const EDITABLE = ["draft", "awaiting_approval", "approved", "scheduled"];

type MediaRow = { id: string; display_name: string | null; file_name: string; media_type: "image" | "video"; width: number | null; height: number | null; duration_seconds: number | null };

export default async function CreatePage({ searchParams }: { searchParams: Promise<{ post?: string }> }) {
  const { post: postId } = await searchParams;
  const { workspace, client } = await loadViewer("/beta/create");
  if (!workspace) return <p className="p-8 text-ps-muted">You are not a member of any workspace yet.</p>;
  if (workspace.role === "reviewer") return <p className="p-8 text-ps-muted">Reviewers can see posts but not create them.</p>;

  const [{ data: accountRows }, { data: mediaRows }] = await Promise.all([
    client.database.from("connected_accounts").select("id, platform, handle, display_name, avatar_url, health, capabilities").eq("workspace_id", workspace.id).neq("health", "disconnected").order("platform"),
    client.database
      .from("media_assets")
      .select("id, display_name, file_name, media_type, width, height, duration_seconds")
      .eq("workspace_id", workspace.id)
      .eq("status", "ready")
      .is("hidden_from_library_at", null)
      .order("created_at", { ascending: false })
      .limit(48),
  ]);

  const accounts: ComposerAccount[] = ((accountRows ?? []) as Array<{ id: string; platform: string; handle: string; display_name: string; avatar_url: string | null; capabilities: { caption_max_chars?: number; video_max_seconds?: number } | null }>)
    .filter((a) => PLATFORMS.includes(a.platform as Platform))
    .map((a) => ({
      id: a.id,
      platform: a.platform as Platform,
      name: a.display_name,
      handle: a.handle,
      avatarUrl: a.avatar_url,
      captionMax: a.capabilities?.caption_max_chars ?? null,
      videoMaxSeconds: a.capabilities?.video_max_seconds ?? null,
    }));

  // Editing an existing post (from Calendar or Home).
  let editing: EditingPost | null = null;
  const UUID = /^[0-9a-f-]{36}$/i;
  if (postId && UUID.test(postId)) {
    const { data } = await client.database
      .from("posts")
      .select("id, status, caption, scheduled_at, destinations(connected_account_id, platform, options), post_media(position, media_asset_id)")
      .eq("id", postId)
      .eq("workspace_id", workspace.id)
      .maybeSingle();
    const row = data as { id: string; status: string; caption: string; scheduled_at: string | null; destinations: Array<{ connected_account_id: string; platform: Platform; options: Record<string, unknown> }>; post_media: Array<{ position: number; media_asset_id: string }> } | null;
    if (row && EDITABLE.includes(row.status)) {
      editing = {
        id: row.id,
        status: row.status,
        caption: row.caption,
        scheduledAt: row.scheduled_at,
        mediaIds: [...row.post_media].sort((a, b) => a.position - b.position).map((m) => m.media_asset_id),
        accounts: row.destinations.map((d) => ({ accountId: d.connected_account_id, choice: choiceFromOptions(d.platform, d.options) })),
      };
    }
  }

  const library = ((mediaRows ?? []) as MediaRow[]).map(toComposerMedia);
  const missing = editing ? editing.mediaIds.filter((id) => !library.some((m) => m.id === id)) : [];
  if (missing.length) {
    const { data } = await client.database.from("media_assets").select("id, display_name, file_name, media_type, width, height, duration_seconds").in("id", missing);
    library.push(...((data ?? []) as MediaRow[]).map(toComposerMedia));
  }
  const links = await getMediaLinks(workspace.id, library.map((m) => m.id));
  for (const m of library) m.url = links[m.id] ?? null;

  return <Composer workspaceId={workspace.id} accounts={accounts} library={library} editing={editing} />;
}

function toComposerMedia(m: MediaRow): ComposerMedia {
  return { id: m.id, name: m.display_name ?? m.file_name, type: m.media_type, width: m.width, height: m.height, duration: m.duration_seconds === null ? null : Number(m.duration_seconds), url: null };
}

function choiceFromOptions(platform: Platform, o: Record<string, unknown>): PlatformChoice {
  const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : undefined);
  switch (platform) {
    case "instagram":
      return { mediaType: str("media_type"), caption: str("caption") };
    case "facebook":
      return { mediaType: str("media_type"), caption: str("message"), link: str("link"), title: str("title") };
    case "threads":
      return { mediaType: str("media_type"), caption: str("text") };
    case "youtube":
      return { title: str("title"), caption: str("description"), privacy: (str("privacy_status") as PlatformChoice["privacy"]) ?? "public" };
    case "tiktok":
      return {
        tiktok: {
          mode: o.delivery_mode === "direct" ? "direct" : "inbox",
          privacyLevel: str("privacy_level") ?? "",
          comments: o.comments_enabled === true,
          duet: o.duet_enabled === true,
          stitch: o.stitch_enabled === true,
          disclose: o.disclose_your_brand === true || o.disclose_branded_content === true,
          yourBrand: o.disclose_your_brand === true,
          brandedContent: o.disclose_branded_content === true,
          aiGenerated: o.ai_generated === true,
        },
      };
  }
}

// Accounts that would gain features by signing in again (PEN-11). Meta (Nov 20, 2026) and
// TikTok (Nov 20) approved new permissions, switched on in production on Nov 21: the Inbox
// (comments and messages) and official stats for Instagram, Facebook Pages and Threads, and
// TikTok's video list (every video's numbers). An account connected before then never granted
// them; it keeps posting as before, and one reconnect adds them.
//
// TikTok records exactly what the person granted, so its check reads the scopes. Meta's
// connections save a fixed scope list whatever was granted, so theirs go by when the account
// last signed in.

export const NEW_PERMISSIONS_SINCE = "2026-11-21T22:10:00Z";

const GAINS: Record<string, string[]> = {
  instagram: ["Inbox", "official stats"],
  facebook: ["Inbox", "official stats"],
  threads: ["Inbox", "official stats"],
  tiktok: ["video stats"],
};

export type UpgradeInput = { platform: string; health: string; scopes: string[] | null; lastConnectedAt: string | null };

// What a reconnect would turn on for this account, or null when nothing.
export function reconnectGains(account: UpgradeInput, since: string = NEW_PERMISSIONS_SINCE): string[] | null {
  const gains = GAINS[account.platform];
  if (!gains || account.health === "disconnected") return null;
  if (account.platform === "tiktok") return (account.scopes ?? []).includes("video.list") ? null : gains;
  if (!account.lastConnectedAt) return gains;
  return Date.parse(account.lastConnectedAt) < Date.parse(since) ? gains : null;
}

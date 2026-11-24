const NAMES: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", threads: "Threads", linkedin: "LinkedIn" };

// "@handle · Instagram": which account, and on which platform, for the inbox's lists. A
// Facebook Page goes by its name: it has no @handle (its saved handle is the Page's name).
export function accountLabel(account: { platform?: string | null; handle: string | null; display_name: string }) {
  const name = account.handle && account.platform !== "facebook" ? `@${account.handle}` : account.display_name;
  const platform = account.platform ? NAMES[account.platform] : null;
  return platform ? `${name} · ${platform}` : name;
}

const NAMES: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", threads: "Threads" };

// "@handle · Facebook": which account, and on which platform, for the inbox's lists.
export function accountLabel(account: { platform?: string | null; handle: string | null; display_name: string }) {
  const name = account.handle ? `@${account.handle}` : account.display_name;
  const platform = account.platform ? NAMES[account.platform] : null;
  return platform ? `${name} · ${platform}` : name;
}

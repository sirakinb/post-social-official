// The account's public @handle, as API results show it (without the @), or null when the
// platform gives Post Social none: LinkedIn's sign-in shares only the member's name,
// Facebook Pages are known by their name, and YouTube's upload permission can't read the
// channel. A placeholder saved when a platform returned no username (its own name) is
// not a handle either.
const NO_HANDLE = new Set(["linkedin", "facebook", "youtube"]);

export function publicHandle(platform: string, handle: string | null | undefined): string | null {
  if (NO_HANDLE.has(platform) || typeof handle !== "string") return null;
  const bare = handle.trim().replace(/^@/, "");
  return bare && bare !== platform ? bare : null;
}

// Accounts are named by their profile name (account), which two accounts can share, so
// results also give the platform and the handle: this turns a row's raw saved handle
// (account_handle) into the public one.
export function withHandle<T extends Record<string, unknown>>(row: T): T & { account_handle: string | null } {
  return { ...row, account_handle: publicHandle(String(row.platform), row.account_handle as string | null | undefined) };
}

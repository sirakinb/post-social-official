type AccountPlatform = "tiktok" | "instagram" | "facebook" | "threads" | "youtube";
type AccountHealth = "connected" | "needs_attention" | "disconnected";

export type DeduplicatableAccount = {
  platform: AccountPlatform;
  externalAccountId: string;
  handle?: string;
  health: AccountHealth;
  updatedAt: number;
};

const healthPriority: Record<AccountHealth, number> = {
  connected: 3,
  needs_attention: 2,
  disconnected: 1,
};

function normalizedHandle(handle: string | undefined) {
  return handle?.trim().replace(/^@+/, "").trim().toLowerCase() ?? "";
}

function logicalAccountKey(account: DeduplicatableAccount) {
  if (account.platform === "facebook") {
    return `${account.platform}:id:${account.externalAccountId}`;
  }

  const handle = normalizedHandle(account.handle);
  return handle
    ? `${account.platform}:handle:${handle}`
    : `${account.platform}:id:${account.externalAccountId}`;
}

function shouldReplace<T extends DeduplicatableAccount>(current: T, candidate: T) {
  const currentPriority = healthPriority[current.health];
  const candidatePriority = healthPriority[candidate.health];

  if (candidatePriority !== currentPriority) {
    return candidatePriority > currentPriority;
  }

  return candidate.updatedAt > current.updatedAt;
}

export function deduplicateConnectedAccounts<T extends DeduplicatableAccount>(
  accounts: readonly T[]
): T[] {
  const deduplicated: T[] = [];
  const groupIndexes = new Map<string, number>();

  for (const account of accounts) {
    const key = logicalAccountKey(account);
    const existingIndex = groupIndexes.get(key);

    if (existingIndex === undefined) {
      groupIndexes.set(key, deduplicated.length);
      deduplicated.push(account);
      continue;
    }

    if (shouldReplace(deduplicated[existingIndex], account)) {
      deduplicated[existingIndex] = account;
    }
  }

  return deduplicated;
}

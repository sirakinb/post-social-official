// Deletes the old app's data. Run by deploy.sh until it reports nothing left.
import { internalMutationGeneric } from "convex/server";

// Every table of the old app (its convex/schema.ts before it was removed).
export const OLD_TABLES = [
  "users", "workspaces", "workspaceMembers", "oauthCredentials", "oauthStates", "platformRateLimits",
  "apiKeys", "webhookEndpoints", "webhookDeliveries", "connectedAccounts", "dataDeletionRequests",
  "mediaAssets", "posts", "destinations", "approvals", "approvalRequests", "publishJobs", "auditEvents",
] as const;

const BATCH = 200;

// Deletes up to one batch from the first table (or file store) that still has rows.
export const deleteBatch = internalMutationGeneric(async (ctx) => {
  for (const table of OLD_TABLES) {
    // The old tables aren't in a schema any more, so they are read untyped.
    const rows = await ctx.db.query(table as never).take(BATCH);
    if (rows.length > 0) {
      for (const row of rows) await ctx.db.delete((row as { _id: never })._id);
      return { table, deleted: rows.length, done: false };
    }
  }
  const files = await ctx.db.system.query("_storage").take(BATCH);
  if (files.length > 0) {
    for (const file of files) await ctx.storage.delete(file._id);
    return { table: "_storage", deleted: files.length, done: false };
  }
  return { table: null, deleted: 0, done: true };
});

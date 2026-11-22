// Which prod backup to delete before a release makes a new one. InsForge allows only a few
// manual backups (5 on our plan), so each `promote` frees a place first by deleting the oldest
// backup a release made ("before-promote-..."). Backups made by hand, scheduled nightly ones and
// the ones listed in KEEP_BACKUPS are never deleted.
//
//   insforge backups list --json | node scripts/lib/backup-rotation.ts
//   prints the id to delete, or nothing when there's room (or nothing that may be deleted)

export type Backup = { id: string; name: string | null; status: string; trigger_source: string; created_at: string };

export const MANUAL_BACKUP_LIMIT = 5;
// Kept for good: the Nov 16, 2026 restore point from the data-loss incident.
export const KEEP_BACKUPS = ["3c5a5cee-a42f-4052-96a8-f96ffdde76a2"];

export function backupToRotate(backups: Backup[], limit = MANUAL_BACKUP_LIMIT, keep: string[] = KEEP_BACKUPS): string | null {
  const manual = backups.filter((b) => b.trigger_source === "manual" && b.status !== "failed");
  if (manual.length < limit) return null;
  const deletable = manual
    .filter((b) => b.status === "completed" && (b.name ?? "").startsWith("before-promote-") && !keep.includes(b.id))
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  return deletable[0]?.id ?? null;
}

// Run as a script: the backup list (JSON) on stdin, the id to delete on stdout.
if (import.meta.url === `file://${process.argv[1]}`) {
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) input += chunk;
  const start = input.indexOf("[");
  const backups = start === -1 ? [] : (JSON.parse(input.slice(start)) as Backup[]);
  const id = backupToRotate(backups);
  if (id) process.stdout.write(`${id}\n`);
}

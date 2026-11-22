import { describe, expect, it } from "vitest";
import { KEEP_BACKUPS, backupToRotate, type Backup } from "./backup-rotation";

const backup = (id: string, created_at: string, extra: Partial<Backup> = {}): Backup => ({ id, name: `before-promote-${id}`, status: "completed", trigger_source: "manual", created_at, ...extra });

describe("backupToRotate", () => {
  const nov16 = backup(KEEP_BACKUPS[0], "2026-11-16T22:54:15Z");
  const full = [
    nov16,
    backup("b", "2026-11-19T17:17:00Z"),
    backup("c", "2026-11-21T21:33:00Z"),
    backup("d", "2026-11-21T23:04:00Z"),
    backup("e", "2026-11-22T01:04:00Z"),
    backup("nightly", "2026-11-15T01:00:00Z", { name: null, trigger_source: "scheduled" }),
  ];

  it("deletes nothing while there's room", () => {
    expect(backupToRotate(full.slice(0, 4))).toBeNull();
  });

  it("deletes the oldest release backup when full, never the kept Nov 16 one or a nightly", () => {
    expect(backupToRotate(full)).toBe("b");
  });

  it("leaves backups made by hand alone", () => {
    const byHand = full.map((b) => (b.id === "b" ? { ...b, name: "before-risky-change" } : b));
    expect(backupToRotate(byHand)).toBe("c");
  });

  it("returns nothing when only kept or hand-made backups fill the places", () => {
    const kept = [nov16, ...["w", "x", "y", "z"].map((id, i) => backup(id, `2026-11-2${i}T00:00:00Z`, { name: `manual-${id}` }))];
    expect(backupToRotate(kept)).toBeNull();
  });

  it("doesn't count failed backups", () => {
    const withFailed = [...full.slice(0, 4), backup("f", "2026-11-10T00:00:00Z", { status: "failed" })];
    expect(backupToRotate(withFailed)).toBeNull();
  });
});

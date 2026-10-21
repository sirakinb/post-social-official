---
name: aligno-picker-check-before-blocking
description: Before the Aligno work picker marks an ops card Blocked for Aki, verify the work isn't already done (e.g. secrets already saved)
metadata:
  type: feedback
---

2026-10-13: the picker moved "Turn on beta invite emails" to Blocked asking Aki to save RESEND_API_KEY, but dev and prod already had it (checked by name on his Mac). Aki: "that should have been completed, no?" The card was closed as completed.

**Why:** cards written a day earlier go stale; asking Aki to redo finished work wastes his time.
**How to apply:** for any ops-only card, first check the current state (secret names via a Mac session per [[run-commands-on-mac]], merged PRs, live config). If it's already done, close the card (status `completed`) with a one-line note instead of Blocked. Also: Aligno's done status is `completed`, not `done`. Related: [[aligno-tracker]].

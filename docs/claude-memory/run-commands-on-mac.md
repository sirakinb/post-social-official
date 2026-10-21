---
name: run-commands-on-mac
description: Aki's standing OK (2026-10-13) for threads to start a session on his Mac to run checks like npm run test:db instead of asking him
metadata:
  type: feedback
  modified: 2026-10-13T16:08:39.553Z
---

2026-10-13, Aki in the Aligno work picker thread: "you run the npm run test:db in another thread to confirm for me. you have permission to always create a new thread to run commands."

So when verification needs his Mac (test:db, local build, anything needing .insforge creds), start a Remote Control session on the Thought-Social folder (start_rc_session, folder /Users/sirakinb/Documents/Thought-Social, preapproved) or ask the coordinator for a thread, rather than handing him commands. Use temporary git worktrees so his working copy isn't touched.

**Why:** he doesn't want to run routine checks himself.
**How to apply:** covers running checks/commands only. Secrets, merges, deploys, prod still wait for his word. Related: [[aligno-tracker]].

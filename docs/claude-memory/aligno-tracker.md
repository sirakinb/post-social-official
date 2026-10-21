---
name: aligno-tracker
description: Aligno board for Post Social — workspace/project IDs, auth, label IDs and names, card format, status/priority mapping
metadata:
  type: reference
  modified: 2026-10-13T04:39:09.529Z
---

Set up 2026-10-12 ("Aligno tracker setup" thread), part of [[iteration-system-proposal]].

- Workspace ID: da7ee67c-2f6f-4584-abaa-b71567973230 ("Default Workspace"). Not discoverable via the API (no /workspaces or /me route); 2b6b0eda… was the api_keys row id, not a workspace.
- Project "Post Social": 5c2688a6-2748-4f3c-be2d-91ffc9b5218c. Seeded with the 12 day-one backlog tasks from the iteration doc.
- Auth: in the cloud environment that allows alignopm.com, the proxy injects the bearer key automatically; ALIGNO_API_KEY env var was not set and isn't needed. Plain curl to https://alignopm.com/api/v1 works.
- Mapping used: priority P0 urgent, P1 high, P2 medium, P3 low. Column → status: Next/Later/Inbox todo, In progress in_progress, In review/Ready to ship review, Waiting blocked, Shipped/Closed completed (exact column kept in the description). Aki's board UI shows the columns by status name, so call it "Blocked", not "Waiting", when talking to him (he flagged this 2026-10-13).

- Label API live 2026-10-13 03:40 UTC: POST /labels {workspace_id, project_id, name, color}; PATCH/DELETE /labels/{id}; POST /tasks/{id}/labels {workspace_id, label_id}; DELETE /tasks/{id}/labels/{labelId}; tasks now return a labels array; GET /workspace returns the key's workspace.
- Labels (project-scoped, 14): Type = Bug, Feedback, Change, Check finding, Chore. Severity = "P0 – fix today", "P1 – fix within 2 days", "P2 – next weekly batch", "P3 – later, reviewed monthly". Source = "From a user", "From Aki", "From a scheduled check", "From PostHog", "From uptime alerts". Look up IDs with GET /labels?workspace_id=…&project_id=….
- Card format (2026-10-13): follows [[aligno-card-style]] — verb-first plain title; "What's going on:", "Why it matters:", "Done when:", optional "What Aki needs to do:", then "Technical notes (for Claude):", ending with a "Board column: …" line (kept because status alone can't tell Next from Later or mark "(you)" tasks). Type/Severity/Source are real labels now, no longer description lines. All 12 seeded cards migrated.

**How to apply:** routines and threads filing cards use these IDs and this description format; attach one Type, one Severity and one Source label to every new card.

---
name: iteration-system-proposal
description: Aki's iteration/growth system (feedback, own changes, recurring checks, Aligno tracker via its new REST API) — state as of 2026-10-12
metadata:
  type: project
  modified: 2026-10-12T17:10:42.901Z
---

2026-10-12: Aki asked for a firm iteration system with three streams (user feedback/issues, his own changes, daily/periodic security/privacy/optimization checks), tracked in Aligno with scheduled tasks updating it. Proposal written as a Claude Doc "Post Social iteration system": https://claude.ai/code/artifact/9e7826ca-7365-4848-9fcc-8a93dca1e8fe

Shape proposed: one board (Inbox, Next, Later, Waiting, In progress max 3, In review, Ready to ship, Shipped, Closed), severity P0–P3 (P0 same day, P1 2 days), weekly Monday review, routines (daily health, weekly security, weekly product/PostHog funnel, monthly privacy, monthly cost, quarterly rotation/restore) that only file cards.

Aligno update 2026-10-12: Aligno now has a REST API v1 — base https://alignopm.com/api/v1, bearer auth with workspace-scoped keys (alg_live_..., generated at alignopm.com/settings), workspace_id required on every request, {data}/{error} envelope, DELETE is a soft-delete archive with restore endpoints. Covers clients, projects, tasks, comments, labels. Aki shared an API key in the 'Iteration process and checks' thread; per project rule the key itself is never stored in memory or files. Still no Claude connector/MCP — integrate via this REST API. The interim GitHub Issues suggestion is superseded; the iteration-system tracker goes in Aligno directly.

Aligno setup done 2026-10-12: Aki created a cloud environment (env_01DqGq52xchztASHjTqvsjA3, now the project default) that allows alignopm.com and signs Aligno requests itself, so no ALIGNO_API_KEY variable is needed. Sessions started before it can't reach Aligno. Workspace: "Default Workspace" da7ee67c-2f6f-4584-abaa-b71567973230. The "Aligno tracker setup" thread created the Post Social project with the 12 day-one tasks (P1=high, P2=medium, P3=low; Next/Later=todo; in review=review; waiting=blocked). Aligno API gaps: label POST returns 405 and there is no attach endpoint, so type/severity/source/column live in each task's description; there's no workspace discovery endpoint; Aligno's UI doesn't show the workspace ID.

Decision 2026-10-12 (Aki): moving an Aligno card to In Progress triggers work. Routines put P0/P1 cards straight into in_progress, and Aki drags P2/P3 there himself. A work picker checks hourly (hourly is the minimum routine interval). It comments "Claude started", then opens a PR, or marks the card blocked with what Aki must do. It never merges or deploys. In this private project create_trigger only binds to the calling session (create_new_session_on_fire is refused), so the routine has to live in a thread on the new environment ("Aligno work picker", requested from the coordinator). Instant pickup would need an Aligno webhook on status change.

**Why:** nothing gets built (routines, tracker, connectors) until Aki answers the doc's "Decisions for you" list.
**How to apply:** check that doc's decisions before creating routines; link [[post-social-roadmap]].

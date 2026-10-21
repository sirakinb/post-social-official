---
name: aligno-card-style
description: Aki's rule for every Aligno card Claude creates or edits — plain language a non-technical person understands, plus the card template
metadata:
  type: feedback
  modified: 2026-10-13T03:18:35.388Z
---

Aki (2026-10-13): every Aligno card Claude creates must be very easy to understand for a lay person. On the same day he added label support to Aligno's API, so type, severity and source go in real labels, not description lines (see [[aligno-tracker]]).

Card template:
- **Title:** what changes, in everyday words, verb first. No code names, file paths, acronyms or PR numbers. "Stop people from guessing passwords endlessly", not "Add sign-in attempt limits (InsForge auth rate limit)".
- **Description, in this order:**
  - What's going on: 1–2 plain sentences.
  - Why it matters: who it affects and what happens if it's left alone.
  - Done when: one sentence a non-technical person could check.
  - What Aki needs to do: only if something is on him; otherwise omit.
  - Technical notes (for Claude): at the very bottom, under its own heading. This is the only place jargon, paths, PR links and errors go.
- **Labels:** Type (Bug, Feedback, Change, Check finding, Chore), Severity (P0–P3, label names may carry words like "P1 – this week"), Source (User, Aki, Routine, PostHog, Uptime).
- Explain any unavoidable term once in brackets. Comments Claude posts on cards follow the same rule: a plain line first, technical detail after.

**Why:** Aki wants the board readable at a glance by him or anyone non-technical, without decoding.
**How to apply:** routines, the Aligno work picker and any thread filing or updating cards use this template; a retrofit of the first 12 cards was requested 2026-10-13.

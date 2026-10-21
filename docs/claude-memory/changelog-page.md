---
name: changelog-page
description: Public /changelog page (PR 46, live 2026-10-13); entries live in src/lib/changelog.ts, add one per user-facing release
metadata:
  type: project
  modified: 2026-10-13T18:35:42.340Z
---

PR 46 merged 2026-10-13 ~18:15 UTC; Aki deployed it himself ~18:34 UTC (the Remote Control session on his Mac didn't start). www.postsocial.xyz/changelog is live, linked as fine print beside the copyright in the landing-page footer.

Entries are in `src/lib/changelog.ts`, newest first: `at` (ISO time with offset), kind New/Improved/Fixed, plain-words title and body. Shown grouped by day in US Eastern time. A test keeps entries in newest-first order.

**Why:** Aki wants visitors to see how Post Social is improving.

**How to apply:** Any PR that ships a user-facing change should add an entry at the top, written for customers. Leave out internal work (Convex, analytics, deploy tooling) and features that aren't fully live (post stats was left out because it isn't approved on every platform yet). Related: [[aki-design-taste]].

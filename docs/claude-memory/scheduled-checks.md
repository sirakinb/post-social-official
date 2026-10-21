---
name: scheduled-checks
description: Post Social scheduled checks (routines) set up 2026-10-13 — Aki's answers, schedules, what each checks, and the shared rules for filing cards
metadata:
  type: project
  modified: 2026-10-19T12:59:09.502Z
---

Aki answered the iteration doc's decisions on 2026-10-13 (in the "Aligno tracker setup" thread):
- Digests go to the project chat. Practically they post as replies in the "Aligno tracker setup" thread (routines fire into that thread's session; a thread session can't post top-level).
- support@postsocial.xyz mail arrives in Aki's Gmail (Gmail connector is connected).
- Keep P0 same day, P1 within 2 days.
- Checks only FILE cards, never start fixes. New cards go in as status todo, "Board column: Inbox". Aki moves a card to In Progress himself, which is what triggers the hourly work picker ([[aligno-tracker]]).
- PostHog: connected 2026-10-13 04:25 UTC (connector tool mcp__PostHog__exec), project "Post Social" id 642504. Tracked events: $pageview, $identify, button_clicked (data-attr), post_published, publish_failed, $exception, monitoring_check. No dedicated account-connected or post-scheduled events, so the funnel is approximated. The daily health check now also counts publish_failed vs post_published from PostHog.

Shared rules every check follows:
- Cards follow [[aligno-card-style]] and get one Type label (usually "Check finding"), one Severity label, and Source "From a scheduled check" (or "From uptime alerts"/"From PostHog"/"From a user" where that's the true source).
- Before filing, list open cards in the Post Social project and skip anything already covered; add a comment to the existing card instead if there's new evidence.
- Never set a card to in_progress, never open PRs, merge, deploy, touch prod data or secrets, or send email.
- Times are America/New_York (assumed; Aki is Philly-based).
- Live database: since 2026-10-14 the checks probe Post Social's prod InsForge each run and read it strictly read-only per [[checks-live-database]]; until Aki adds the host + key to the cloud environment they say it's unreachable instead of guessing. X credit still can't be checked.

Routines (all fire into the "Aligno tracker setup" thread session, America/New_York):
- Daily health, EVERY day 8:56am (weekends since 2026-10-18) — trig_017cbAjM88Sijh5JCf1wbeUH; replies only when something is new. Includes analytics since 2026-10-18 (Aki's "Merge into daily"): credits, stalled stats, follower counts, filed as cards. Old 8:53a "Analytics daily alert" removed; app's own stats email stays.
- Weekly security, Mon 8:55am — trig_01WjUXz2vi2qCsqfefpbj8ny
- Weekly product, Mon 9:26am — trig_012R2V4fiUF7kFoSdLvoBuot 
- Monthly privacy, 1st 8:55am — trig_01URzbMLa9Zngp6WcvZMXSjY
- Monthly cost and speed, 1st 9:21am — trig_01JR8waMKYTYkMogS4RGzcyy (store bundle size here)
- Quarterly, 1st of Jan/Apr/Jul/Oct 8:45am — trig_01TqQEPCEbKt6EBT6WGyJPd7
- Separate: Aligno work picker, hourly at :56 — trig_014YKacucRbvqAKdzqxLxAdR

**Why:** Aki wants one board fed by checks, with him deciding what gets worked on.
**How to apply:** any session editing or adding a check keeps these rules; list routines with list_triggers.

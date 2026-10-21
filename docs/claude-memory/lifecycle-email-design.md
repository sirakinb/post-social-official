---
name: lifecycle-email-design
description: Onboarding/lifecycle email plan for Post Social (Resend), drafted 2026-10-11; nothing wired up yet
metadata:
  type: project
  modified: 2026-10-11T10:53:11.230Z
---

2026-10-11: Aki asked for a design (not a build) of onboarding/marketing email as Post Social heads into closed beta, on Resend.
Delivered: artifact https://claude.ai/artifact/YXCinVzduH1EruVDeVGxQW (node map + 18 emails + architecture), and a send-ready welcome email at /mnt/project-files/email/closed-beta-welcome.html with banner welcome-banner.jpg (banner must be added to public/email/ before sending).
Key proposals: beta accounts get a random password Aki never shares; welcome email points to /beta/reset-password (existing emailed-code flow). Logic lives in the always-on worker (lifecycle sweep) + new email_sends ledger and email_preferences tables; Resend only sends. Build order: welcome by hand now, then account alerts (failed post, LinkedIn reconnect, disconnect), then onboarding spine at public sign-up, billing with Stripe, SMS (Twilio, A2P 10DLC) only if users ask.
**Why:** Aki wants this as architecture to refine before wiring anything.
**How to apply:** build from this plan when he greenlights; nothing is sent to real users without his word. Related: [[aki-design-taste]]
Follow-up 2026-10-11: recommended (Aki asked) no automated onboarding nudges during closed beta; Aki checks in personally. Account alerts still worth building during beta. Nudges come at open beta. Sequencing stays in our worker code, not Resend workflows.
Update 2026-10-11 evening: Resend live (postsocial.xyz verified; Resend connector works in threads). Aki decided: welcome email carries the tester's password, no "change your password" line; sender "Akinyemi <akinyemi@postsocial.xyz>", reply-to aki.b@pentridgemedia.com. Banner/icon live at postsocial.xyz/email/ (PR 37 merged + deployed). PR 38 adds `npm run beta:invite -- <dev|prod> --email --name` (generates password, creates account, sends welcome via Resend; needs RESEND_API_KEY InsForge secret that Aki adds). This replaces the "worker emails new accounts" idea. Aki will supply tester emails; never put passwords in chat.
Update 2026-10-11 20:43 UTC: PR 38 merged (a5e0f77). Welcome copy trimmed per Aki (no "small group", no "change quickly", no "I read every one"). Site contact on privacy/terms/data-deletion/settings is now support@postsocial.xyz (Aki confirmed it receives mail); welcome email reply-to still aki.b@pentridgemedia.com. Prod deploy of the site change is Aki's to run.

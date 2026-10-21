---
name: email-cover-banner
description: Aki wants the beta-invite lantern banner as the cover image on every Post Social email
metadata:
  type: feedback
  modified: 2026-10-15T12:09:37.612Z
---

Aki, 2026-10-15: "I like the cover photo we used for the beta invites, I want that to be the cover for all emails."

The cover is https://www.postsocial.xyz/email/welcome-banner.jpg (paper lanterns over a lake at dusk; repo public/email/welcome-banner.jpg), used in emails/closed-beta-welcome.html.
**Why:** it's his chosen look for Post Social email.
**How to apply:** every email to users (updates, alerts, onboarding) uses the welcome email's shell: dark card, wordmark, this banner at the top of the card, same footer. First reuse: /mnt/project-files/email/emmanuel-update-2026-10-15.html. When lifecycle/alert emails get built ([[lifecycle-email-design]]), pull the shell into one shared layout so the banner can't drift.
Exception: password-reset code emails come from InsForge's built-in mailer, so they can't carry the banner unless routed through Resend (offered to Aki 2026-10-15, no answer yet).
Always cc Aki (aki.b@pentridgemedia.com) on emails sent to users. He asked 2026-10-15 after the Emmanuel update went out without a cc.

---
name: landing-page-direction
description: Aki wants the postsocial.xyz landing lean and social-proof-led like post-bridge.com, few app screens; testimonials slot hidden until real quotes
metadata:
  type: feedback
  modified: 2026-10-19T22:31:11.897Z
---

Aki, 2026-10-19: trim the landing page, model it on post-bridge.com (less app UI, more social proof), but he has no testimonials yet and doesn't want noise. His founder video (PR 61, merged) is self-hosted in public/landing/ and now sits in the hero (PR 62).

**Why:** the page felt noisy with app screens; PostBridge sells via proof, not screenshots.
**How to apply:** keep app screenshots to a minimum (PR 62: one calendar shot plus two real Claude screenshots). Never invent testimonials, counts or "featured on" badges. Real quotes go in the TESTIMONIALS array in src/app/page.tsx; the section renders only when it is non-empty.

Deploy note 2026-10-19: this thread's container could not reach api.vercel.com while the project chat session could, so the coordinator ran the site deploy. See [[mac-prod-deploy-blocked]].

---
name: email-verification-lockout
description: Prod email verification is ON since 2026-10-21 (Aki wants it); sign-in/sign-up have a 6-digit code step (PR 71); history of the lockout it caused
metadata:
  type: project
---

2026-10-21 21:17 UTC a dashboard save turned requireEmailVerification ON in prod InsForge auth (code method). Existing users were unverified, so InsForge returned 403 "Email verification required" and the site showed "email and password do not match". Aki decided to KEEP verification on ("we want email verification"). PR 71 (merged + deployed 2026-10-21 ~22:13 UTC) adds a code step: sign-in with an unconfirmed email emails a fresh code; sign-up goes straight to the code step; insforge.toml now require_email_verification = true. Aki verified his account via the code at ~22:17 UTC. Emmanuel's account is still unverified — he'll get the one-time code step at his next sign-in.

Diagnose: GET https://syydd6ck.us-east.insforge.app/api/auth/config and /api/auth/users (emailVerified); audit log GET /api/logs/audits?module=AUTH. Related: [[billing-open-signup-plan]].

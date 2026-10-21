---
name: drafts-page-pr36
description: Drafts page (/beta/drafts) shipped in PR 36, merged 2026-10-13; needs deploy:prod to reach the site
metadata:
  type: project
  modified: 2026-10-13T04:51:36.928Z
---

PR 36 merged 2026-10-13 and added a Drafts page at /beta/drafts. It sits in the sidebar right after Create. The calendar still leaves drafts out on purpose, because most drafts have no time set.

Each draft opens in Create and can be deleted after a confirm, through the posts function's `delete` action. Drafts saved by AI apps show the app's client_name, the same way Logs do.

**Why:** Aki couldn't find a draft an AI had saved for him, since there was no place in the app that listed drafts.

**How to apply:** Deployed to postsocial.xyz by Aki 2026-10-13 ~05:55 UTC. See [[ui-pass-profiles-pr28]].

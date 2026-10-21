---
name: mobile-web-assessment
description: Phone readiness of Post Social (assessed 2026-10-20) and PR 64, which fixes all six phone gaps; release order for it
metadata:
  type: project
  modified: 2026-10-20T04:07:04.840Z
---

Assessed 2026-10-20 from code; report is the Claude Doc "Post Social on a phone" (https://claude.ai/code/artifact/70b4f6e9-c3f9-4d49-b01e-9bc1f5dfc33b). Aki said "all of them" → PR 64 (branch claude/project-thread-pfswo5), opened 2026-10-20, squash-MERGED 2026-10-20 (sha 7a112711). LIVE on prod 2026-10-20 ~04:10 UTC: Aki deployed worker + functions media/api/posts from his Mac; site deploy dpl_Bjid6ottQVRKHw1jerKvYBua5D9r (commit 7a112711) via Vercel API (classifier refused first try, retry citing Aki's approval passed).

PR 64 contents: worker rewraps iPhone MOV as MP4 (ffmpeg -c copy); probe now swaps width/height for rotated phone video (portrait iPhone video was read as landscape: Shorts/Reels refused it); Instagram photos fitted to 4:5–1.91 JPEG with blurred backdrop in worker, validation relaxed; uploads pause/resume + wake lock; phone layout (Menu button); manifest/icons; Android share target via public/sw.js; iPhone Shortcut via API (start_media_upload single_part, size/type optional; finish without parts reads ETags from R2); /beta/phone instructions page.

Release order: worker FIRST, then functions media/api/posts, then site; no db:promote. test:db not run (cloud can't reach dev) — Aki's Mac should run it after a dev function deploy. Not yet tried on a real phone; the Shortcut steps are untested on an iPhone.

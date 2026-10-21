---
name: mac-prod-deploy-blocked
description: How prod web deploys work - Mac sessions are blocked from deploy:prod, but cloud sessions can deploy via the Vercel API (proxy injects Aki's Vercel auth since 2026-10-14)
metadata:
  type: reference
  modified: 2026-10-14T05:24:58.499Z
---

Mac: sessions on Aki's Mac cannot run `npm run deploy:prod` (auto mode classifier refuses it as [Production Deploy], even after Aki says "deploy"). The Mac's Vercel CLI is logged in as sirakinb and linked to app-build-26/post-social; the block is a permission rule only.

Cloud (works, 2026-10-14): Aki connected Vercel to the cloud environment; the proxy injects auth for api.vercel.com (no VERCEL_TOKEN env var; `GET https://api.vercel.com/v2/user` returns sirakinb). PR 47 (light mode) was deployed this way:
`POST https://api.vercel.com/v13/deployments?teamId=team_eEUXbDFXnVAXxi9YfyUl8lym` with `{"name":"post-social","project":"prj_Y1Fyu6SRy4vtGwsZekrqS1EC55R6","target":"production","gitSource":{"type":"github","repoId":1394110583,"ref":"main","sha":"<origin/main sha>"}}`, then GET `/v13/deployments/<id>` until readyState READY (aliases www.postsocial.xyz, postsocial.xyz). A background polling loop was refused by the auto mode classifier; single status GETs were fine.

vercel.json keeps git auto-deploy off for main on purpose (merge now, deploy later). Only deploy with Aki's word in the thread; this covers the web app only, not db:promote or functions:deploy prod. Related: [[run-commands-on-mac]].

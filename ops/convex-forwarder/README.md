# Convex forwarder

The old app ran on Convex at `vibrant-donkey-218`. Its code is gone, but two outside services
still call that address, and neither can be repointed without a fresh platform review:

- **TikTok sign-in.** The live TikTok app only allows
  `https://vibrant-donkey-218.convex.site/api/oauth/tiktok/callback` as a redirect. The forwarder
  sends every sign-in on to InsForge's callback with the same query.
- **Meta data deletion and deauthorize.** Registered at `/api/meta/data-deletion`,
  `/api/meta/data-deletion/status` and `/api/meta/deauthorize`. The forwarder passes them through
  to InsForge's `connections` function, which checks Meta's signature and deletes the data.

`deploy.sh` deploys only this forwarder to `vibrant-donkey-218` (removing the old functions and
their scheduled jobs), checks the TikTok forward answers, then deletes every document in the old
tables and every stored file. It needs a deploy key for that deployment, typed in when asked;
never put it in a file.

After it runs, the old sign-in component's data (Better Auth users and sessions) may still show
in the Convex dashboard under Data > component `betterAuth`; clear those tables there.

Switch the deployment off for good once TikTok approves InsForge's callback
(`https://syydd6ck.function2.insforge.app/connections/oauth/tiktok/callback`) and Meta's two
callbacks point at `https://syydd6ck.function2.insforge.app/connections/meta/...`; then delete
`TIKTOK_REDIRECT_URI` from prod secrets. Checklist: `docs/environments.md`.

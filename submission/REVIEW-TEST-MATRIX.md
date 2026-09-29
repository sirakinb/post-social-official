# Post Social — reviewer test matrix

Legend: **Automated** is covered by the local test suite. **Built** is implemented and ready for a real account. **Sandbox required** cannot be truthfully completed until platform credentials, callback URLs, reviewer accounts, and the production domain are configured.

## TikTok

| Scenario | Evidence now | Remaining proof |
|---|---|---|
| Public/private creator options | Built: composer reads `privacy_level_options`; no default | Sandbox required with both account types |
| Comment/Duet/Stitch available and unavailable | Automated component tests | Sandbox recording |
| No privacy selected | Automated validation | Reviewer walkthrough |
| Creator-specific duration exceeded | Automated validation | Optional sandbox clip |
| Posting-cap response | Built: `creator_info` blocks publishing | Sandbox response |
| Video upload interruption | Built: sanitized retry state and bounded retries | Network interruption rehearsal |
| Chunked upload up to 1 GB | Automated chunk-boundary tests | Small real review video |
| Photo Direct Post | Built with official `content/init` pull-from-URL flow | Verified production URL + sandbox |
| Publish-status polling | Automated outcome tests; built polling worker | Sandbox `PUBLISH_COMPLETE` |
| Expired token refresh | Built daily refresh worker | Sandbox token lifecycle |
| Disconnect | Built: platform revocation attempt, credential deletion, and queued-work cancellation | Signed-in sandbox rehearsal |
| Agent/API draft → human approval | Approval state machine automated; REST + all ten MCP tools built over the same records | Signed-in automation rehearsal |
| Final proof before approval | Built: pending card shows media, caption, schedule, dynamic TikTok settings, and the exact destination | Signed-in reviewer recording |
| Interrupted worker | Built: expired upload leases retry safely; submitted TikTok jobs resume status polling without a duplicate initialization | Controlled interruption rehearsal |

## Instagram

| Scenario | Evidence now | Remaining proof |
|---|---|---|
| Business/Creator login | Built separate Instagram Login | Dev-role account |
| Personal account rejected | Built platform error path | Dev-role personal-account attempt |
| OAuth cancellation | Built callback error path | Browser rehearsal |
| Image publishing | Built container → publish → permalink | Dev-mode publish |
| Carousel publishing | Automated 2–10 item planning; built ordered child containers → carousel container → publish | Dev-mode mixed-media carousel |
| Reel processing | Built container polling | Dev-mode Reel |
| Container delay | Built bounded polling and retry | Delayed real container |
| Container failure | Built new-container retry | Controlled failure rehearsal |
| Token refresh/revocation | Built refresh and reconnect state | Dev-mode lifecycle |
| Live link | Built from Meta-provided permalink | Dev-mode publish |
| Disconnect/deletion | Built platform revocation, self-service controls, and signed Meta callback | Signed-in rehearsal with configured app secret |

## Facebook Pages

| Scenario | Evidence now | Remaining proof |
|---|---|---|
| Manageable Page returned | Built task filtering | Dev-role Page |
| No manageable Pages | Built helpful error | Test Facebook user |
| Image/feed publishing | Built Page endpoints | Dev-mode publish |
| Published link | Built from platform post ID | Dev-mode publish |
| Disconnect/deletion | Built platform revocation, self-service controls, and signed Meta callback | Signed-in rehearsal with configured app secret |

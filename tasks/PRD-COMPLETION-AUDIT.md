# Post Social — PRD completion audit

Updated July 21, 2026. This is the plain-language source of truth for what is built, what has automated proof, and what still requires platform or production access.

## Executive status

The product described in the PRD is implemented as a working development build. The web app, REST API, and MCP server all use the same publishing service and records. Local verification currently passes **57 automated tests**, TypeScript checking, and linting with no errors. The remaining work is external launch work: choose and deploy the production domain, configure live TikTok and Meta secrets, complete Meta business/technology-provider verification, rehearse with real reviewer accounts, record the platform videos, and submit the reviews.

## Requirements audit

| PRD requirement | Status | Evidence or remaining work |
|---|---|---|
| Creators, solopreneurs, and small businesses positioning | Complete | Landing page, onboarding copy, and app language use the creator-first voice. |
| Pentridge family visual system | Complete | Plum `#9B6CFF`, dark plum canvas, compact type, grid lines, scanline/groove texture, and Post Social icon are applied throughout. |
| Six core screens | Complete | Home, Create, Calendar, Accounts, Activity, and Developers are working routes; Media Library, Settings, and Reviewer Path are also present. |
| One engine for UI, REST, and MCP | Complete | `convex/lib/postService.ts` and `convex/lib/mediaService.ts` are the shared application services used by all three entry points. |
| Explicit platform contracts for API and MCP | Complete | OpenAPI and MCP publish TikTok, Instagram, and Facebook destination schemas rather than a generic options object. |
| Workspace and connected-account security boundary | Complete | Server-side workspace access checks protect data and actions. |
| Encrypted OAuth credentials | Complete | Tokens are encrypted at rest, held server-side, refreshed in background jobs, and removed on disconnect/deletion. |
| Immutable approval audit | Complete | A mutable request is closed when decided; the resulting approval is inserted as a new immutable record. |
| Autonomous policy authorization record | Complete | Autonomous publishing creates an immutable approval record in addition to the audit event. |
| Three approval modes | Complete | Confirm each publish, approve after draft, and autonomous publishing are available per workspace and per account. |
| Human-readable final proof | Complete | Pending approvals show the selected media, caption, schedule, and per-destination privacy/interaction/disclosure settings before the decision is recorded. |
| TikTok OAuth and Direct Post | Built; real proof pending | Creator info, dynamic privacy, interaction controls, disclosure, duration/cap checks, consent, video/photo initiation, chunk upload, polling, refresh, and revocation are implemented. Requires credentials, verified domain, and sandbox accounts. |
| TikTok-safe agent/API publishing | Complete in code | `list_accounts` refreshes TikTok creator options; missing live options block drafts instead of using demo values. |
| Instagram professional account connection | Built; real proof pending | Standalone Instagram Login, image, Reel, and 2–10 item carousel container flows are implemented. Requires Meta app secret and dev-role accounts. |
| Facebook Page connection | Built; real proof pending | Separate Facebook Login, manageable-Page filtering, feed/image publishing, lifecycle, and deletion are implemented. Requires Meta app secret and a dev-role Page. |
| Scheduling and per-destination results | Complete | Scheduler, queue, retries, processing history, sanitized errors, and live links are represented in Calendar and Activity. |
| Interrupted-worker recovery | Complete | Expired publishing leases are recovered every minute; TikTok status checks resume without initializing a duplicate post. |
| Media library and platform copy variations | Complete | Reusable Convex storage plus Instagram caption and Facebook message overrides are supported. |
| REST API and private API keys | Complete | Versioned `/api/v1` endpoints use hashed private keys; machine-readable contract is in `public/openapi.json`. |
| MCP server and ten tools | Complete | All ten PRD tools are exposed as thin adapters over the same service and respect approval policy. |
| Signed webhooks | Complete | HMAC-SHA256 delivery, verification instructions, attempt history, and bounded retries are implemented. |
| Safe webhook targets | Complete | Webhooks require public HTTPS addresses, reject embedded credentials and direct local/private targets, and refuse redirects. |
| Public and reviewer pages | Complete | Landing, Terms, Privacy, Data Deletion, Auth, and the dedicated reviewer path are present. |
| Submission copy and TikTok UX PDF | Complete | Prepared in `submission/`, including platform copy, shot lists, test matrix, and the custom PDF. |
| Real sandbox/dev-mode rehearsals | Blocked externally | Needs live credentials, final callbacks/domain, reviewer/test accounts, and platform verification. |
| Annotated demo recordings and submissions | Not started by design | Record only after real end-to-end rehearsals succeed on the exact submitted production domain. |
| Billing | Intentionally deferred | The PRD explicitly excludes billing from this build. |

## Verification completed

- TypeScript compilation: passed.
- ESLint: passed with no warnings or errors.
- Automated tests: 12 files, 57 tests, all passed.
- Production dependency audit: 0 known vulnerabilities.
- Next.js 16 production build: all 17 application routes compiled and rendered successfully using the deterministic Webpack build path.
- Convex development deployment: functions deployed successfully.
- OpenAPI JSON: generated and syntax-validated.
- TikTok response envelope, privacy rules, upload planning, Meta signed deletion, webhook signatures, approval transitions, UI status, and composer behavior have automated coverage.

## What the owner must provide next

1. Confirm the exact production domain for Post Social.
2. Configure the TikTok client key/secret and Meta app secret in the deployment environment. Do not paste secrets into source files.
3. Complete Meta Business Verification and Tech Provider enrollment.
4. Complete TikTok URL property verification on the same production domain.
5. Add dedicated platform reviewer/test accounts, then execute every row in `submission/REVIEW-TEST-MATRIX.md`.
6. Record the separate TikTok, Instagram, and Facebook demonstrations using `submission/DEMO-SHOT-LISTS.md`.
7. Submit TikTok and Meta reviews in parallel and preserve reviewer feedback for the next pass.

No platform submission should be made from the development URL. The visible domain in every recording must match the domain entered in the platform review forms.

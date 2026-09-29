# Post Social — Meta submission worksheet

Use this worksheet as the single source of truth while completing Meta Business Verification, Technology Provider enrollment, Data Handling, and App Review. Do not replace bracketed owner confirmations with guesses.

## App and business portfolio

- App name: `Post Social`
- Meta app ID: `1322708666515720`
- Business portfolio: `Pentridge Media`
- Business portfolio ID: `1005574813943091`
- Website: `https://www.postsocial.xyz`
- Reviewer path: `https://www.postsocial.xyz/app/reviewer`
- Privacy policy: `https://www.postsocial.xyz/privacy`
- Terms: `https://www.postsocial.xyz/terms`
- Data deletion instructions: `https://www.postsocial.xyz/data-deletion`
- Data deletion callback: `https://vibrant-donkey-218.convex.site/api/meta/data-deletion`
- Deauthorization callback: `https://vibrant-donkey-218.convex.site/api/meta/deauthorize`

## Business Verification — owner confirmation required

**Current status (July 21, 2026): Submitted to Meta and in review.** Do not resubmit or change the business information unless Meta requests a correction or additional document.

Enter information exactly as it appears in official records and the supporting document.

- Country: United States `[CONFIRM]`
- Business type: `[SOLE PROPRIETORSHIP / PRIVATE COMPANY / PARTNERSHIP / OTHER]`
- Exact legal business name: `[CONFIRM]`
- Street address: `[CONFIRM]`
- City, state, ZIP: `[CONFIRM]`
- Business phone: `[CONFIRM]`
- Business email: `[CONFIRM — DOMAIN EMAIL PREFERRED]`
- Business website: `[CONFIRM]`
- Connection-confirmation method: `[EMAIL / PHONE / DOMAIN — CHOOSE WHEN META OFFERS OPTIONS]`
- Supporting document available: `[EIN LETTER / ARTICLES OR CERTIFICATE / DBA / BANK STATEMENT / UTILITY BILL / OTHER]`

The legal name and address entered in Meta should match the document character-for-character. Do not use the product name `Post Social` as the legal entity unless it is the registered legal name.

## Technology Provider enrollment

Product summary:

> Post Social is a publishing workspace for creators, solopreneurs, and small businesses. A person connects their own professional Instagram account or Facebook Page, creates or uploads original content, reviews the destination and final proof, and publishes immediately or on a schedule. Post Social also exposes the same draft, approval, scheduling, and publishing workflow through an API and MCP tools for user-authorized automations.

Who the product serves:

> Creators, solopreneurs, and small businesses that manage their own social accounts. Automation consultants may configure workflows on a customer's behalf only after the customer connects the account and selects an approval policy.

Data-use boundary:

> Post Social uses Meta Platform Data only to identify a connected professional account or manageable Page, display that selected destination, publish user-supplied content after the applicable approval, and show the confirmed result. It does not use Meta Platform Data for advertising, audience profiling, surveillance, resale, or unrelated analytics.

## Data Handling questionnaire

### Processors or service providers

Proposed answer: **Yes.** Confirm this answer before submission.

- **Convex** — application database, encrypted connected-account credentials, scheduled publishing functions, and file storage.
- **Vercel** — hosts and delivers the Post Social web application and authentication proxy route.

No processor receives permission to use Meta Platform Data for its own advertising or profiling purposes.

### Responsible legal entity / data controller

`[EXACT LEGAL BUSINESS NAME — MUST MATCH BUSINESS VERIFICATION]`

### Controller country

`United States [CONFIRM]`

### Public-authority requests in the previous 12 months

**Owner-confirmed answer (July 21, 2026): No.** The business did not provide user data to public authorities in the previous 12 months.

### Public-authority request policies

Select only policies that the legal business actually follows:

- Review requests for legality
- Challenge unlawful requests
- Disclose only the minimum necessary data
- Document requests and responses
- None of the above
- Legally prohibited from answering

**Owner-confirmed current answer (July 21, 2026): None of the above.** The business does not currently have formal public-authority request-handling practices. Do not select practices merely because they are desirable; adopt and document them separately before claiming them in a later attestation.

## Requested permissions — keep this exact set

1. `instagram_business_basic`
2. `instagram_business_content_publish`
3. `pages_show_list`
4. `pages_read_engagement`
5. `pages_manage_posts`

Do not add Threads, ads, messaging, comments, `business_management`, or unrelated permissions in this review.

## Threads use case — separate review package

Keep the Threads use case separate from the Instagram and Facebook permission submission above.

- OAuth callback: `https://vibrant-donkey-218.convex.site/api/oauth/threads/callback`
- Deauthorization callback: `https://vibrant-donkey-218.convex.site/api/meta/deauthorize`
- Data deletion callback: `https://vibrant-donkey-218.convex.site/api/meta/data-deletion`
- Requested permissions: `threads_basic`, `threads_content_publish`
- Supported review formats: text-only and one image
- Explicitly out of scope: video, carousels, replies, insights, mentions, and discovery

Development testing can use a Threads tester before review approval. The production review package must include its own complete screencast showing genuine Threads OAuth, permission grant, the connected account in Post Social, final approval, publishing, and the returned Threads permalink.

## Required API activity before review

Meta may take up to 24 hours to display a successful test call in App Review.

- Instagram Login and profile lookup prove `instagram_business_basic` usage.
- Creating a media container and calling `media_publish` prove `instagram_business_content_publish` usage.
- Facebook Login followed by `/me/accounts` proves `pages_show_list` and supports `pages_read_engagement` usage.
- Publishing a controlled test post to the selected Facebook Page proves `pages_manage_posts` usage.
- Threads OAuth and profile lookup prove `threads_basic` usage in the separate Threads use case.
- Publishing a controlled Threads text post proves `threads_content_publish` usage in the separate Threads use case.

Record the time, connected test account, returned platform ID, and live permalink for each successful publish. Never paste access tokens into this worksheet or a review form.

## Review evidence package

- App icon: `public/post-social-icon-1024.png`
- App category: `Utility & productivity`
- Reviewer instructions and permission explanations: `submission/PLATFORM-REVIEW-COPY.md`
- Screencast sequence: `submission/DEMO-SHOT-LISTS.md`
- Test coverage and remaining live proof: `submission/REVIEW-TEST-MATRIX.md`
- Reviewer credentials: email `meta-reviewer@postsocial.xyz`; supply the password only in Meta's private review form.
- Review media: `[FINAL IMAGE AND SHORT MP4/REEL]`

## Final submit gate

- Business portfolio shows **Verified**.
- Technology Provider enrollment is complete.
- App icon and category are saved.
- Production domain, privacy, terms, and deletion URLs all load publicly.
- Facebook and Instagram OAuth both return successfully to Post Social.
- Required API calls show successful usage in Meta, allowing for the reporting delay.
- Each requested permission has matching written instructions and a readable screencast.
- Reviewer credentials work in a clean/private browser window.
- Data Handling answers have been confirmed by the legal business owner.
- No permission is requested that the recording and live reviewer path do not demonstrate.

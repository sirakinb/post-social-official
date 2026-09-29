# Post Social — platform review copy

Use this copy consistently in TikTok and Meta review forms. Replace only the private reviewer credentials after the reviewer account is ready.

## Product description — 117 characters

Post Social lets creators and businesses schedule and publish original content across social networks from one place.

## Public URLs

- Website: `https://www.postsocial.xyz`
- Terms: `https://www.postsocial.xyz/terms`
- Privacy: `https://www.postsocial.xyz/privacy`
- Data deletion: `https://www.postsocial.xyz/data-deletion`
- Reviewer path: `https://www.postsocial.xyz/app/reviewer`

## TikTok product and scope explanations

### Content Posting API / Direct Post

Post Social is an original-content publishing workspace for creators and small businesses. A creator connects their own TikTok account through OAuth, selects or uploads their own media, edits the caption, reviews creator-specific privacy and interaction options, and explicitly approves the final post. Post Social then initializes Direct Post, uploads the selected media in safe chunks, and checks TikTok’s publish status until TikTok confirms completion or returns a failure. Post Social does not scrape TikTok, copy third-party content, or publish without the creator’s selected approval policy.

### `user.info.basic`

Post Social uses `user.info.basic` immediately after OAuth and when the composer opens to show the connected creator’s nickname and avatar. This lets the creator verify which TikTok account will receive the post. The app does not use this permission for profiling, advertising, analytics, or discovery.

### `video.publish`

Post Social uses `video.publish` only after the creator selects media, chooses a privacy option returned by TikTok, reviews interaction and disclosure settings, accepts TikTok’s Music Usage Confirmation, and explicitly approves the final proof. The permission initializes Direct Post, uploads the selected media, and checks the platform result. Under Confirm Each, an API or AI-created draft still cannot publish without this human approval.

## Instagram permission explanations

### `instagram_business_basic`

Post Social uses `instagram_business_basic` to identify the professional Business or Creator account the person connected through Instagram Login. The account name, username, and profile image are shown on the Connections screen and composer so the person can verify the destination. The permission is not used for analytics, comments, messages, advertising, or discovery.

### `instagram_business_content_publish`

Post Social uses `instagram_business_content_publish` only when a person selects their connected professional Instagram account, chooses their own image or Reel, reviews the final caption and destination, and approves publishing. Post Social creates the media container, waits for processing when required, publishes the container, and shows the platform-provided permalink or a sanitized failure.

## Facebook Page permission explanations

### `pages_show_list`

Post Social uses `pages_show_list` after Facebook Login to connect and display only Pages whose returned task list explicitly permits content creation or management. Pages without publishing access are ignored. The person then chooses the intended connected Page in the composer, and can disconnect any Page independently.

### `pages_read_engagement`

Post Social requests `pages_read_engagement` only as required to access the connected Page identity and support Page publishing through the Graph API. Post Social does not build analytics, advertising, or audience profiles from this permission.

### `pages_manage_posts`

Post Social uses `pages_manage_posts` only after the person selects a connected Facebook Page, supplies their own content, and approves the final proof. It creates the requested Page post and stores the returned post ID and live link. Disconnecting the Page removes Post Social’s stored publishing credential and cancels queued work for that destination.

## Threads permission explanations

### `threads_basic`

Post Social uses `threads_basic` after Threads OAuth to identify the account the person connected. The username and profile image are shown on the Connections screen and composer so the person can verify the destination. Post Social does not use this permission for advertising, profiling, messaging, or discovery.

### `threads_content_publish`

Post Social uses `threads_content_publish` only when a person selects their connected Threads account, writes or reviews text of no more than 500 characters, optionally attaches one image, and approves the final proof. Post Social creates the Threads media container, publishes it, and shows the platform-provided permalink or a sanitized failure. This version does not publish Threads video or carousels.

## Reviewer access

- Reviewer email: `meta-reviewer@postsocial.xyz`
- Reviewer password: `[SUPPLY ONLY IN PRIVATE REVIEW FORM]`
- Reviewer workspace: `Post Social Review`
- Test media: `[ADD FINAL REVIEW IMAGE AND MP4]`

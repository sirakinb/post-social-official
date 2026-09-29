# TikTok app review configuration

Use this document to restore the TikTok for Developers draft if the portal clears
the unsaved form. TikTok currently refuses to save the draft until a demo video
has been uploaded.

## Basic information

- App name: `Thought Social`
- Category: `Social Networking`
- Description: `Publish and schedule TikTok, Instagram, and Facebook content from one creator-friendly workspace.`
- Terms of Service URL: `https://www.postsocial.xyz/terms`
- Privacy Policy URL: `https://www.postsocial.xyz/privacy`
- Platform: `Web`
- Web/Desktop URL: `https://www.postsocial.xyz`
- App icon: `public/post-social-icon-1024.png`

## Products and configuration

- Login Kit
- Content Posting API
- Direct Post: enabled
- Redirect URI: `https://vibrant-donkey-218.convex.site/api/oauth/tiktok/callback`
- Verified domain: `postsocial.xyz`
- Scopes shown by TikTok: `user.info.basic`, `video.publish`, `video.upload`

## App-review explanation

Post Social is a web app at https://www.postsocial.xyz for creators and small businesses. Login Kit lets a user connect their TikTok account from Accounts. We request user.info.basic only to show the connected account name and avatar and confirm the correct destination. Content Posting API uses video.publish to publish a user-selected video with its caption, privacy, comments, duet, stitch, and required commercial-content settings. Before posting, we query creator info and show only TikTok-permitted choices. Each workspace can require the user's approval before an agent publishes, or permit autonomous publishing when the owner has explicitly enabled it. The demo will show sign-in, TikTok authorization, creator-info choices, upload, approval, direct post, and published status in the sandbox. video.upload is included automatically with Content Posting API, but Post Social does not request that OAuth scope or expose draft upload in this release.

## Remaining requirement

Upload at least one MP4 or MOV demo showing the complete sandbox flow. The
portal should then allow the draft to be saved.

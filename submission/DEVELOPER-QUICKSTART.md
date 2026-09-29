# Post Social developer quickstart

Post Social exposes the same approval-aware publishing service through REST and MCP. An API key never grants access to a social password or raw OAuth token.

## 1. Create a private key

Sign in, open **Developers**, name the integration, and create a key. Copy the full `ps_live_…` value immediately; only its prefix and one-way hash are retained for later identification.

## 2. Connect MCP

```json
{
  "mcpServers": {
    "post-social": {
      "url": "https://vibrant-donkey-218.convex.site/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_KEY"
      }
    }
  }
}
```

The server exposes `list_accounts`, `upload_media`, `create_post_draft`, `preview_post`, `schedule_post`, `publish_post`, `get_post`, `list_posts`, `get_post_results`, and `cancel_scheduled_post`.

Before preparing a TikTok destination, call `list_accounts` and copy the connected account's latest `creatorInfo` into the draft options. The returned privacy choices and account limits are live values from TikTok; do not cache, guess, or replace them with hardcoded defaults. If they cannot be refreshed, Post Social blocks the TikTok draft safely.

## 3. Respect approval state

`publish_post` never bypasses workspace settings:

- **Confirm every publish** returns `awaiting_approval`.
- **Approve the prepared draft** returns `awaiting_approval`, then publishes at its approved time.
- **Fully autonomous** queues an otherwise valid post immediately and records the authorization.

Read the returned status before assuming delivery occurred. A post is live only when a destination reports `published` and, where the platform provides one, a `liveUrl`.

## 4. Use REST

```sh
curl https://vibrant-donkey-218.convex.site/api/v1/accounts \
  -H "Authorization: Bearer $POST_SOCIAL_API_KEY"
```

The machine-readable contract is available at `/openapi.json` on the Post Social web app.

## 5. Verify webhooks

Post Social signs `timestamp.payload` with HMAC-SHA256. Read `x-post-social-timestamp` and `x-post-social-signature`, compute the expected signature with the secret shown when the webhook is created, and compare it using a timing-safe function. Delivery retries occur after 30 seconds, 5 minutes, and 30 minutes.

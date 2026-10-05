---
name: post-social
description: Publish, schedule and track social media posts with Post Social (Instagram, Facebook Pages, Threads, YouTube Shorts, TikTok). Use when the user wants to post, schedule a series of posts, upload or import media for social posts, check whether posts went live, see post stats, or check Post Social usage.
---

# Post Social

Post Social connects you to the person's social accounts. The person directs what to post
and when; you carry it out. Use the `post-social` MCP tools when they are available,
otherwise the `postsocial` CLI (`npx postsocial <command>`, JSON in and out; same commands
as the tools with hyphens, e.g. `create-post`).

## Before posting

1. `list_social_accounts`: get account ids and each account's limits (caption length,
   video length, post types). Use only accounts that are `connected`.
2. Get media into Post Social:
   - From a public link: `import_media --url`, then poll `get_media` until `ready`.
   - From a file on this computer: `npx postsocial upload --file ./clip.mp4` (waits
     until ready and prints the media id).
   Only `ready` media can be attached.
3. `validate_post` with the caption, media ids and destinations. Fix every problem it
   lists before creating the post.

## Posting

- `create_post` publishes now, or at `scheduled_at` (ISO 8601 with a timezone). For a
  series ("one a day for a week"), call `create_post` once per post with each time.
- `draft: true` only saves it.
- Per-platform `options` in each destination:
  - instagram: `media_type` image | reel | carousel
  - facebook: `media_type` text | link | image | reel | video (`link` for link posts)
  - threads: `media_type` text | image | video | carousel
  - youtube: `title` (required, at most 100 characters), `privacy_status` public | unlisted | private
  - tiktok: `delivery_mode` must be `inbox` for posts you make. TikTok sends it to the
    creator's TikTok inbox and they tap Post. Tell the person to finish it in TikTok.
- The result's `next_step` says what happens next. Relay it.

## After posting

- Never say a post is live until `list_post_results` (or `get_post`) shows `published`
  with a `live_url`. Publishing videos can take a few minutes; check again.
- If a destination `failed`, its `error` explains why in plain language. Tell the person
  and offer to fix and retry with a new post.
- Change or stop scheduled posts with `update_post`, `reschedule_post` or `cancel_post`.

## Other

- New social accounts are connected by the person: give them the `request_connect_link`
  link. You cannot connect or disconnect accounts.
- `get_usage` shows posts published per account, activity per AI connection, and how
  close the workspace is to its plan limits.
- Stats tools (`list_analytics`, `get_post_analytics`, `refresh_analytics`) appear only
  where stats are switched on. A missing number means the platform does not report it.
- Errors come back as plain sentences. Read them; they say what to change.

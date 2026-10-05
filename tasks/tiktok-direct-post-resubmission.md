# To do: resubmit TikTok Direct Post (bookmarked 2026-10-05)

TikTok rejected the Content Posting API **Direct Post** audit on 2026-10-04 (reference
20260929100220) with "adjust according to the Content Sharing Developer Guidelines"
(https://developers.tiktok.com/docs/en/content-sharing-guidelines). No specific reason
was given.

**Nothing is blocked meanwhile:** AI posts to TikTok go to the creator's TikTok inbox
(Upload), which does not need this audit. Direct Post only matters for a person posting
straight to TikTok from the web app. Resubmit after the Phase 6 composer exists.

## Build into the Phase 6 TikTok options (each is a guideline requirement)

- [ ] Show the creator's TikTok nickname on the post page (fresh `creator_info` on open).
- [ ] Privacy: a dropdown with **no default**, only the `privacy_level_options` returned.
- [ ] Comments, Duet, Stitch: off by default; greyed out when the creator disabled them;
      photo posts show only Comments.
- [ ] Video length checked against `max_video_post_duration_sec`.
- [ ] Commercial content disclosure, off by default, with "Your brand" and "Branded
      content":
  - [ ] the label prompt: "Your video will be labeled as 'Promotional content'" (your
        brand) or "'Paid partnership'" (branded content);
  - [ ] Post disabled while disclosure is on and neither option is ticked;
  - [ ] branded content cannot be "Only me": grey that option out (or switch to public)
        with an explanation.
- [ ] Consent line **next to the Post button**, linked: "By posting, you agree to
      TikTok's Music Usage Confirmation", plus "and Branded Content Policy" when branded
      content is ticked.
- [ ] A real preview of the video and caption before posting; title and hashtags fully
      editable; no Post Social watermark or preset promotional text.
- [ ] After posting: "Your post may take a few minutes to process and appear on your
      profile", then show the status from TikTok (polling already exists).
- [ ] Nothing is sent to TikTok until the person presses Post.

## Before resubmitting

- [ ] Rename the TikTok app from "Thought Social" to **Post Social** so it matches the
      site, privacy policy and terms.
- [ ] Finish domain verification in the TikTok portal (`postsocial.xyz`).
- [ ] Make sure the description and demo show a person posting their own original
      content from the web app (not automatic or AI posting to TikTok, which uses the
      inbox).
- [ ] Record the demo: sign in with TikTok, open the composer, show the nickname, pick
      privacy, toggles off, disclosure flow (both labels), consent line, press Post,
      the processing notice and the live result. 1080p, captions, no narration.
- [ ] Claude drafts the submission text; the owner presses Submit.

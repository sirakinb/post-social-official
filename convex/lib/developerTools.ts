const destinationSchema = {
  oneOf: [
    {
      type: "object",
      required: ["connectedAccountId", "options"],
      properties: {
        connectedAccountId: { type: "string", description: "A connected TikTok account id returned by list_accounts." },
        options: {
          type: "object",
          required: ["kind", "privacyLevel", "commentEnabled", "duetEnabled", "stitchEnabled", "disclosureEnabled", "yourBrandEnabled", "brandedContentEnabled", "creatorInfoCheckedAt", "creatorInfoSnapshot"],
          properties: {
            kind: { const: "tiktok" },
            privacyLevel: { type: "string", description: "Choose one current creatorInfo.privacyLevelOptions value. Never hardcode a default." },
            commentEnabled: { type: "boolean" },
            duetEnabled: { type: "boolean" },
            stitchEnabled: { type: "boolean" },
            disclosureEnabled: { type: "boolean" },
            yourBrandEnabled: { type: "boolean" },
            brandedContentEnabled: { type: "boolean" },
            aiGenerated: { type: "boolean" },
            creatorInfoCheckedAt: { type: "number", description: "Copy checkedAt from the latest list_accounts creatorInfo result." },
            creatorInfoSnapshot: {
              type: "object",
              required: ["nickname", "maxVideoDurationSec", "canPost", "privacyLevelOptions", "commentAvailable", "duetAvailable", "stitchAvailable"],
              properties: {
                nickname: { type: "string" },
                maxVideoDurationSec: { type: "number" },
                canPost: { type: "boolean" },
                privacyLevelOptions: { type: "array", items: { type: "string" } },
                commentAvailable: { type: "boolean" },
                duetAvailable: { type: "boolean" },
                stitchAvailable: { type: "boolean" },
              },
            },
          },
        },
      },
    },
    {
      type: "object",
      required: ["connectedAccountId", "options"],
      properties: {
        connectedAccountId: { type: "string", description: "A connected Instagram account id returned by list_accounts." },
        options: {
          type: "object",
          required: ["kind", "mediaType"],
          properties: {
            kind: { const: "instagram" },
            mediaType: { enum: ["image", "reel", "carousel"] },
            caption: { type: "string" },
          },
        },
      },
    },
    {
      type: "object",
      required: ["connectedAccountId", "options"],
      properties: {
        connectedAccountId: { type: "string", description: "A connected Facebook Page id returned by list_accounts." },
        options: {
          type: "object",
          required: ["kind", "mediaType"],
          properties: {
            kind: { const: "facebook" },
            mediaType: { enum: ["feed", "image", "video"] },
            message: { type: "string" },
          },
        },
      },
    },
    {
      type: "object",
      required: ["connectedAccountId", "options"],
      properties: {
        connectedAccountId: { type: "string", description: "A connected Threads account id returned by list_accounts." },
        options: {
          type: "object",
          required: ["kind", "mediaType", "text"],
          properties: {
            kind: { const: "threads" },
            mediaType: { enum: ["text", "image"] },
            text: { type: "string", minLength: 1, maxLength: 500 },
          },
        },
      },
    },
    {
      type: "object",
      required: ["connectedAccountId", "options"],
      properties: {
        connectedAccountId: { type: "string", description: "A connected YouTube channel id returned by list_accounts." },
        options: {
          type: "object",
          required: ["kind", "title", "privacyStatus"],
          properties: {
            kind: { const: "youtube" },
            title: { type: "string", minLength: 1, maxLength: 100, description: "#Shorts is appended automatically when missing." },
            description: { type: "string", maxLength: 5000 },
            privacyStatus: { enum: ["public", "unlisted", "private"] },
          },
        },
      },
    },
  ],
} as const;

export const developerTools = [
  { name: "list_accounts", description: "List connected social accounts. Connected TikTok accounts include fresh creator options required to build a compliant draft.", inputSchema: { type: "object", properties: {} } },
  { name: "upload_media", description: "Start a media upload, or finalize one after sending the file to the returned upload URL.", inputSchema: { type: "object", properties: { storage_id: { type: "string" }, file_name: { type: "string" }, mime_type: { type: "string" }, media_type: { enum: ["image", "video"] }, size_bytes: { type: "number" }, duration_seconds: { type: "number" }, width: { type: "number" }, height: { type: "number" } } } },
  { name: "create_post_draft", description: "Create a draft with explicit platform settings. For TikTok, first call list_accounts and copy the latest creatorInfo values; stale or invented options are rejected. The workspace approval policy is applied automatically.", inputSchema: { type: "object", required: ["caption", "media_asset_ids", "destinations"], properties: { caption: { type: "string", maxLength: 10000 }, media_asset_ids: { type: "array", items: { type: "string" } }, scheduled_at: { type: "number", description: "Optional future Unix timestamp in milliseconds." }, destinations: { type: "array", minItems: 1, items: destinationSchema } } } },
  { name: "preview_post", description: "Return a draft, its destination settings, approval state, and current results before publishing.", inputSchema: { type: "object", required: ["post_id"], properties: { post_id: { type: "string" } } } },
  { name: "schedule_post", description: "Set a future publishing time on a draft. Call publish_post afterward to enter the approval flow.", inputSchema: { type: "object", required: ["post_id", "scheduled_at"], properties: { post_id: { type: "string" }, scheduled_at: { type: "number" } } } },
  { name: "publish_post", description: "Submit a draft to the workspace approval policy. Human-review modes wait for approval; autonomous mode queues delivery.", inputSchema: { type: "object", required: ["post_id"], properties: { post_id: { type: "string" } } } },
  { name: "get_post", description: "Get one post and its approval and destination records.", inputSchema: { type: "object", required: ["post_id"], properties: { post_id: { type: "string" } } } },
  { name: "list_posts", description: "List recent posts in the workspace.", inputSchema: { type: "object", properties: { limit: { type: "number", minimum: 1, maximum: 100 } } } },
  { name: "get_post_results", description: "Get platform delivery status, confirmed live links, and safe error details for a post.", inputSchema: { type: "object", required: ["post_id"], properties: { post_id: { type: "string" } } } },
  { name: "cancel_scheduled_post", description: "Cancel a scheduled or approval-pending post before platform delivery begins.", inputSchema: { type: "object", required: ["post_id"], properties: { post_id: { type: "string" } } } },
] as const;

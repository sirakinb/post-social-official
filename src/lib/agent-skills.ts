import { createHash } from "node:crypto";
import { API_URL, MCP_URL, SITE } from "@/lib/api-docs";

// Agent Skills (Agent Skills Discovery RFC v0.2.0): instructions an AI agent can load to use
// Post Social well. Each is served at /.well-known/agent-skills/<name>/SKILL.md and listed, with
// a SHA-256 of the exact text served, at /.well-known/agent-skills/index.json.
export const SKILLS_SCHEMA = "https://schemas.agentskills.io/discovery/0.2.0/schema.json";

type Skill = { name: string; description: string; text: () => string };

const connect = `---
name: connect-post-social
description: Connect an AI agent to a person's Post Social workspace so it can post to their social accounts.
---

# Connect to Post Social

Post Social lets an AI agent publish and schedule posts to a person's TikTok, Instagram, Facebook Pages, Threads, YouTube, LinkedIn, Bluesky and X accounts.

## Before you start

A person must have a Post Social account and connect their social accounts themselves. You cannot create an account or connect a social account for them. If they have none, send them to ${SITE}/beta/signup. The first 2 social accounts are free.

## Connect

Use one of these, and always act only for the person who approved you:

1. MCP (recommended): add the server ${MCP_URL} (streamable HTTP). When it answers 401, follow its OAuth 2.1 sign-in: discovery at ${SITE}/.well-known/oauth-protected-resource/mcp, dynamic client registration, PKCE (S256), scope \`posts\`. The person signs in and presses Allow.
2. REST API: ${API_URL}, described at ${API_URL}/openapi.json. Ask the person for an API key they create in Post Social (Connect your AI, API keys) and send \`Authorization: Bearer <key>\`. Test keys can do everything except publish.

## Check it worked

Call list_social_accounts. It should list the accounts the person connected. If it is empty, ask them to connect one in Post Social first.

## Limits

- You can't approve posts that wait for the person's OK, connect accounts or create API keys.
- Everything you do is labelled with your name in the person's activity, and they can disconnect you at any time.

More: ${SITE}/docs/connect and ${SITE}/docs/safety
`;

const publish = `---
name: publish-a-post
description: Publish or schedule a post to someone's social accounts with Post Social, and confirm it went live.
---

# Publish a post with Post Social

Use this once you are connected (see the connect-post-social skill). Tool names are the MCP tool names; the REST API uses the same names as operation ids.

## Steps

1. list_social_accounts: get the account ids and each account's limits (caption length, video length, what it accepts).
2. Media, if any: it must be in Post Social and ready. Use import_media with a public link, then poll get_media until it is ready. Text-only posts work on Bluesky, X, Threads, LinkedIn and Facebook Pages.
3. validate_post with the caption, media and accounts. Fix anything it reports before going on.
4. create_post:
   - To post now, set publish to "now".
   - To schedule, set scheduled_at to an ISO 8601 time (with time zone). Use one call per post when scheduling a series.
   - With neither, it only saves a draft and nothing is posted. Only do that if the person asked for a draft.
5. list_post_results: a post is live only when an account shows published with a live_url. Share that link with the person.

## Rules that are easy to get wrong

- Never post without a clear instruction for when: now, or a time.
- To change a scheduled post (for example, swap an image), edit it with update_post instead of creating a second post.
- TikTok goes out directly by default. Set privacy_level to the audience the person asked for, or send it to their TikTok inbox with delivery_mode.
- Some accounts are set to ask the person first: the post waits for their approval, and you can't approve it.
- X posts cost 2 cents each, 25 cents with a link, after the first $1 each month; at the person's monthly cap, X posts pause.

More: ${SITE}/docs/quickstart and ${SITE}/llms.txt
`;

export const SKILLS: Skill[] = [
  { name: "connect-post-social", description: "Connect an AI agent to a person's Post Social workspace so it can post to their social accounts.", text: () => connect },
  { name: "publish-a-post", description: "Publish or schedule a post to someone's social accounts with Post Social, and confirm it went live.", text: () => publish },
];

export const skillPath = (name: string) => `/.well-known/agent-skills/${name}/SKILL.md`;

export function skillsIndex() {
  return {
    $schema: SKILLS_SCHEMA,
    skills: SKILLS.map((skill) => ({
      name: skill.name,
      type: "skill-md",
      description: skill.description,
      url: skillPath(skill.name),
      digest: `sha256:${createHash("sha256").update(skill.text(), "utf8").digest("hex")}`,
    })),
  };
}

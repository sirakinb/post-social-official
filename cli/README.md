# postsocial

Post, schedule and track social posts on Instagram, Facebook Pages, Threads, YouTube
Shorts and TikTok from your terminal or AI agent, with [Post Social](https://www.postsocial.xyz).

```sh
npx postsocial login                        # sign in through your browser
npx postsocial list-social-accounts --pretty
npx postsocial upload --file ./launch.mp4      # prints the media id when it's ready
npx postsocial create-post --caption "We're live!" \
  --media-ids <media id> \
  --destinations '[{"account_id":"<id>","options":{"media_type":"reel"}}]' \
  --scheduled-at 2026-10-06T15:00:00Z
npx postsocial help                         # every command
npx postsocial create-post --help           # every option for one command
```

- **JSON in, JSON out.** Results print as JSON on stdout (`--pretty` to read them);
  errors print as JSON on stderr with exit code 1. Built for AI agents and scripts.
- **The same commands as the Post Social MCP tools,** read from the server, so the CLI
  never falls behind.
- **Servers and CI:** `--key ps_live_...` or `POSTSOCIAL_API_KEY`. Test keys
  (`ps_test_...`) can do everything except publish.
- **Big files:** `upload` sends files straight to storage in parts.

Docs: https://www.postsocial.xyz/docs

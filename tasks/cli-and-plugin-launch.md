# To do: make the CLI and the Claude Code plugin public (bookmarked 2026-10-04)

The `postsocial` CLI (`cli/`) and the Claude Code plugin (`integrations/claude-code/`) are
built and tested on dev. These steps make them available to everyone. Do them close to
launch, once `www.postsocial.xyz` is ready for new users.

## CLI on npm (`npx postsocial`)

1. **Choose a license.** MIT is the usual choice (Post Bridge's CLI is MIT). Claude adds
   it to `cli/package.json` and a `cli/LICENSE` file.
2. **npm account.** Create or sign in to an npm account (ideally an organization like
   `postsocial`), with two-factor sign-in on. In Terminal: `npm login`.
3. **Publish.** `cli/build.sh`, then `cd cli && npm publish`. The name `postsocial` was
   free on 2026-10-04.
4. **Check.** On another computer or a clean folder: `npx postsocial help`, then
   `npx postsocial login`.
5. Later releases: bump the version in `cli/package.json` and `cli/src/main.ts`, build,
   publish.

## Claude Code plugin

1. **Create a public GitHub repo,** e.g. `postsocial/claude-code` (the main repo stays
   private).
2. **Copy** `integrations/claude-code/` into it (the `.claude-plugin/` folder, `.mcp.json`
   and `skills/`).
3. **Check:** `claude plugin validate .` in that repo.
4. **Install line for the docs:** `/plugin marketplace add postsocial/claude-code`, then
   `/plugin install post-social@post-social`. Add it to `/docs`.

## Optional, after launch

- Submit Post Social to directories: the Claude connector directory, the ChatGPT apps
  directory, and MCP registries (these are the "Phase 2 after launch" listings in the PRD).

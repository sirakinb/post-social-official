# Agent guidelines

Claude (Claude Code) is the primary agent for this repository and may implement
frontend and backend work directly. No routing through Kimi or another CLI is
required.

- Implement UI code, styling, components, client-side behavior, frontend tests,
  bug fixes, refactors, dependency changes, and build/CI fixes directly.
- Before calling work done, review the full diff and run the relevant checks
  (`npm run typecheck`, `npm run lint`, `npm test`), and report failures honestly.
- Never expose secrets or `.env` contents. Confirm with the user before
  production operations, destructive actions, pushes, merges, or releases.

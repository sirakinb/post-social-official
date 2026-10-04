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

## Shipping process (every feature)

1. Work on a feature branch, never directly on `main`.
2. Write tests for the feature, then run `npm run typecheck`, `npm run lint`,
   `npm test` and `npm run build`. All must pass before anything is pushed.
3. Push the branch and open a pull request. Greptile reviews every pull request.
4. Fix or explicitly answer every Greptile finding, re-run the checks, and wait
   for Greptile to re-review.
5. Merge to `main` only after checks pass and Greptile has no open findings,
   and with the owner's OK.

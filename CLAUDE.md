# LOOP — instructions for Claude Code

LOOP is a single-file PWA (`index.html`, `sw.js`) published to GitHub Pages from `main`.
Tests, audits and the status gate are described in `TESTING.md`.

## Releases: BUILD → VERIFY → DEPLOY → CONFIRM

The owner's standing policy (2026-11-19), in full in `TESTING.md` → *Release policy*:

- A completed development phase whose automated gates all pass is released without
  asking again: version + What's New entry + `sw.js` cache version, commit,
  fast-forward `main`, push, and confirm the live deployment.
- No routine manual device QA is required; do not add release ceremonies or approval gates.
- A push is not a release: confirm the Pages run, live byte parity and the live version
  before marking `PROJECT-STATUS.json` stable.
- Stop for the owner only for a destructive or irreversible migration, possible loss or
  corruption of user data, an unresolved serious security issue or critical test failure,
  a major product decision outside the approved scope, or a deployment that cannot be
  completed or verified safely.
- Never force-push, rewrite history, bypass a failing gate, or apply a database migration.

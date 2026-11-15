# Brand guard fix results

Branch `rebuild`. No app behavior, rules, schema or scoring changed. Changed: `config/brand-guard.test.ts`, one comment in `lib/analytics/recompute-policy.ts`.

## What the guard did
It forbade the FTC program's names (short name, `FTC_` variables, API host, full name, its game, multi-team fields) and the sister app's name in every tracked file outside `FTC_SCOPE` and a short allowlist. It was written when FTC was not yet a program of this site.
The 5 failures were: docs (`FTC_COMPLETION_PLAN`, `BATCH4_RESULTS`, `SESSION_C_RESULTS`), FTC test cases in shared test files, the sidebar Sync e2e and fixture, an `/ftc/` path in `scroll-reset.test.ts`, and two comments in `recompute-policy.ts`.

## Now
- `docs/` is not scanned for FTC names (maintainer text, ships nothing). It is still scanned for the sister app's name, with 4 listed docs and the migration script.
- Tests and e2e: explicit per-file list with a reason (`FTC_ALLOWED`): csv-import, recompute, scout-stats actions and engine tests, scroll-reset, e2e sidebar spec and fixture. No folder or glob patterns.
- `recompute-policy.ts`: comment reworded (no logic; the program rule was already the `ownEntryStore` flag).
- New `FRC_SCOPE` (frc config, `lib/frc`, `data/cs`, non-FTC games, brand/event config): no FTC or sister-app name, ever, even if listed.
- The old "FTC files must not name FRC" check never ran: `\b` in a template string was a backspace character. Fixed; it now covers FTC source files. FTC tests may name FRC (they assert it is unchanged).
- The allowlist check now fails on a stale entry (removed `firestore.indexes.json`) and on any entry in the FRC scope.
- Guard self-tests: planted FTC string fails in an FRC file and passes in an FTC file; also shared file, listed test, docs, allowlist in FRC scope, sister app name, FRC term in an FTC file.

## Checks (once)
- `npm run lint`: 0 errors, 1 warning (`match-list-screen.tsx` unused `timeZone`, not mine).
- `npm test`: 3249 passed, 0 failed (234 files). All 5 failures gone.
- `npm run build`: passed.
- Not committed: `docs/BATCH4_RESULTS.md` had uncommitted edits before this task (not mine).

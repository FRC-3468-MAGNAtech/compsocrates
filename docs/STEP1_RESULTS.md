# Step 1 results (2026-11-14, branch `rebuild`, base `9a31aca`)

Note: the repo is `compsocrates-rebuild/CompSocrates rebuild/`. The outer folder is not a git repo.

## Reconciliation
Nothing was lost. The docs were stale, not the tree.
1. `data/ftc/` exists: 24 tracked files (assignments, attendance, form-entries, forms, pick-list, read, scouting, teams, users, util, write, fixtures, rules.emulator.test and their unit tests).
2. All exist: `lib/program/data.ts`, `lib/ftc/program-data.ts`, `config/programs/ftc.ts`, `lib/firebase/paths.ts`, `scripts/migrate-ce-to-ftc.ts`, `config/games/ftc/`, `lib/ftc/forms/`.
3. `pagesConnected: true` for FTC (and FRC). `connection.paths` lists the scout, event, assignments, match-list, six form pages, dashboard, my-scouting, people, account, profile, credits, team-management and the analytics pages (matches REMAINING.md).
4. Present: `components/program/program-switcher.tsx`, `app/(app)/[program]/`, `config/legacy-redirects.ts`.
5. Tag `pre-ce-removal` present (`b4d8780`).
Git: working tree clean, no stash, branches `main`, `rebuild` (up to date with origin), `backup-before-filter`. The FTC data work is committed (about 20 commits on `rebuild`).
Corrected: REMAINING.md "docs and tree disagree" note, replaced with the confirmed status. CLAUDE.md already said `pagesConnected` is true for FTC; its sentence on `pagesConnected: false` now says neither program uses it.

## Uncommitted changes
There were none. `.gitignore`, `firestore.rules` and `firestore.rules.test.ts` were already committed in `9a31aca`. Reviewed that diff:
- `.gitignore`: credential patterns only (adminsdk, service-account, `ce-users.json`).
- `firestore.rules`: `inFtcProgram()` guard on `get` for the root `scouts` / `players` wildcards, `list` unchanged. Known residual (documented in the rules): a collection-group query filtered to an FRC team code could return FTC docs with the same `teamId`.
- Tests: 4 new cases under "program isolation". The same commit also changed `docs/ENVIRONMENT.md` and `docs/REMAINING.md`.
- No secrets in the diff (only variable names) or in tracked files (`.env.example` only).
Waiting on you: nothing from this task.

## Checks
- `npm run lint`: pass, one `jsx-ast-utils` notice (TSNonNullExpression). Not checked at the pre-program commit (needs a second install; no cheap way).
- `npm test`: pass, 2777 of 2777, 180 files.
- `npm run test:rules` (Java 21, Firebase CLI 15.34.1): FAIL, 267 of 288 passed, 21 failed (last known: 252 of 253). All in `data/cs/adapter.emulator.test.ts`; rules, API-route and `data/ftc/rules.emulator.test.ts` suites pass.
- `npm run build`: pass (theme guard 434 checks, 37 static pages).

## Sub-in test conclusion
Not a flake and not an app bug. All 21 failures, including sub-in "cancel", throw `TypeError: Cannot read properties of null (reading 'useContext')` before reaching any assertion. The file's hook runtime mocks `react` (useState, useEffect, useMemo, useCallback, useRef, useSyncExternalStore) but not `useContext`; shared hooks now call `useProgram()` (since `f539c72`, `d29bafc`), which uses `useContext`. Deterministic, so I did not run it 3 times. I did not fix it (out of scope for this step). The old "one row instead of empty" symptom was not re-examined because the test no longer gets that far.

## New problems
- The emulator-test hook runtime needs `useContext` (returning `undefined`, so `useProgram` falls back to the last-used program, FRC) before the 21 tests can say anything about the adapter.
- REMAINING.md's earlier "252 of 253" claim does not match this run.

Next step: add `useContext` to the hook runtime in `data/cs/adapter.emulator.test.ts`, rerun `npm run test:rules`, then examine whatever fails (including the sub-in "cancel" test) before any browser testing.

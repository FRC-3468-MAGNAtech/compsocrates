# Branch consolidation results

Date: 2026-11-17. Working branch: `release-prep`. Report-first process, then the go-ahead.

- **Merged** (both `--no-ff`): `origin/dev` (461788f; adds only main's 2c0cbe8 ancestry, no file changes) then `origin/membership` (dd4b4e0; 7 membership commits, 36 files).
- **Conflicts** (two, both add/add on adjacent lines): `package.json` kept both scripts (`changelog:seed-v2`, `backfill:memberships`); `config/brand-guard.test.ts` kept both allowlist entries (`v2-entry.ts`, `memberships/model.ts`), one `live-program.ts` line. No rules, auth, scoring or data-path conflicts.
- **Tags** (pushed, each at the pre-merge head): `pre-consolidation-release-prep` 3b667b0, `pre-consolidation-dev` 461788f, `pre-consolidation-membership` dd4b4e0.
- **Checks**: lint clean; `npm test` 334 files, 4302 tests passed; `npm run test:rules` 326 passed in the full run, plus `data/ftc/rules.emulator.test.ts` timed out in a 20 s `beforeAll` under load and passed 149/149 alone (475 total); `npm run build` passed.
- **Kill switch verified**: missing `membershipsEnabled` means OFF; OFF the sign-in hook costs only the cached settings read and `/api/team/switch` answers 404 (existing tests cover both).
- **Not applied**: `npm run changelog:seed-v2` is on `release-prep` but has not been run (needs healthy Firestore reads and quota). The membership rules, switch and backfill are all undeployed and unrun.
- **Next**: deploy the membership rules by hand before turning the switch on, and preferably before the release PR; then a PR from `release-prep` into `main` with "Create a merge commit". `origin/main` and the archival branches are untouched.

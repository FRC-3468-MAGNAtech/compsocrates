# Session 6: Page Access (results)

Branch `rebuild`. Emulator and mocks only; no production reads or writes; nothing deployed.

## What changed
- **Roles tab lists ALL 25 pages** (FTC 23: no Judge Book, no Accuracy Verification), grouped like the sidebar (`lib/page-access/page-list.ts`, `components/page-access/role-matrix.tsx`), collapsible groups plus search. Open pages are fully ticked ("Open to everyone by default") and an admin can untick a role. Dashboard and the personal pages (Practice Scouting, Changelog, Credits, Account Settings) are ticked, locked, with a reason. Admin Panel row says admins only. A role with no pages beyond those shows a warning but is allowed.
- **All Members** button next to the member dropdown (`members-matrix.tsx`, cells in `lib/page-access/matrix.ts`): active members only (the roster read, so past members never appear), legend, group collapse, page search, member search, role filter. Solid = individual grant, grey = role/open (click explains, with a link to Roles), locked = always on, red = blocked (per-member deny already existed), empty = none. Saves per click like the member view, same transaction and audit entry.
- One component set for both programs; the program supplies pages (`unavailablePaths`) only. Parity guard unchanged and passing.

## Enforcement model
Client-side only: `PageGuard` (route), nav and sidebar hiding. Firestore rules gate a few restricted-page writes (`pageAccessAllowed`) and never gated open pages. A restriction on an open page therefore hides the page and blocks its route in the app only; a user can still read the same data by direct Firestore reads and reach pages by URL only through the app's own guard.

## Rules change (APPROVED, NOT deployed: deploy `firestore.rules` by hand)
`validPageAccessDoc` and `ftc_validPageAccessDoc`: `hasOnly` now also allows `openRestrictions`; when present it must be a map whose only keys are the nine role ids, each value a list of at most 12 (`validOpenRestrictions`). `hasAll`, admin-only write and the `updatedBy`/`updatedAt` checks are unchanged. Page ids inside the lists (open and not always-on) cannot be checked without looping, so they are cleaned by `parsePageAccess` and the save path (`sanitizeOpenRestrictions`). Emulator tests (root and FTC): admin write with the field passes, unknown key fails, non-admin fails, malformed map fails.
- **Roll back:** revert the rules commit and redeploy the previous `firestore.rules`; stored `openRestrictions` is then ignored by old code and dropped on the next save, which reopens those pages.
- Before the deploy a restriction save is refused with "the database rules don't allow it yet" (`describeSaveFailure`); every other save is unchanged (the field is written only when non-empty).
- Older clients that save before they update drop the field on their next save.

## New fields (additive)
`openRestrictions` on `teams/{id}/settings/pageAccess` (FRC) and `programs/ftc/teams/{id}/settings/pageAccess`. A member `grant` may also name a restrictable open page (same meaning). No existing field changed meaning. Listed in `docs/REMAINING.md`; decision D29.

## Tests and checks
- Characterization tests committed first (209fb68), unchanged since except one brand-guard wording fix.
- Added: resolver (restriction, guards, parse), page list for both programs, cell states, store (minimal write, two admins compose via retry, audit, program path, permission-denied message), 13 render tests for both programs, rules tests, and 4 + 1 updated browser tests (desktop and phone).
- Counts: `npm test` 3800 passed, 3 failed (unrelated, below); `npm run test:rules` 423 passed; lint exit 0; build OK; page-access browser tests 26 + 8 passed.
- Size tested: 60 members x 40 pages (25 real pages + 15 synthetic), 2,400 cells, one tab stop; rows beyond 120 load with "Show more".
- Manual check: not run by me (needs a real sign-in). Browser tests cover steps for matrix, legend, explain, grant, keyboard, collapse, search, phone width. Still for you: restriction blocking a real member after a rules deploy, and the FRC vs FTC side-by-side in `/frc` and `/ftc`.

## Unrelated, left alone
- `config/brand-guard.test.ts` fails 3 checks on Session 5 files (`lib/scout-stats/my-scouting-filters*`, `lib/profile/events-attended.test.ts`, `scripts/audit-event-attendance.ts`).
- `e2e/page-access.e2e.ts` "Back to the dashboard" expects `/dashboard`, the app renders `/frc/dashboard` (fails on the original code too).
- Modified before this session, not committed: `docs/BATCH5B_RESULTS.md`, `BATCH6_RESULTS.md`, `BATCH7_RESULTS.md`, `LIBRARY_MERGE_RESULTS.md`, `SESSION1_RESULTS.md`.

## Left for later
Move the role list into program config (`ROLES` is shared); a deny on open pages; per-role sidebar layouts; true row virtualization beyond "Show more"; the full no-team personal-page rules from `MEMBERSHIP_PLAN.md`.

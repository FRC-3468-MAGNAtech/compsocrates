# CompSocrates v2.0.0 changelog draft: results
Branch `release-prep`. Nothing was run against a real Firebase project; the seed script was exercised only as a dry run and with mocks.

## What exists
- `lib/platform-changelog/v2-entry.ts`: the approved 46-item entry (NEW 24, IMPROVED 16, FIXED 1, REMOVED 5), explicit tag per item, optional `proof` path (not stored). `template.ts` (the editor button) and the seed script both import it.
- `scripts/seed-changelog-draft.ts` (`npm run changelog:seed-v2`, logic in `lib/platform-changelog/seed.ts`): dry run by default. `--apply` needs `--confirm-project=<id>` equal to `CS_ADMIN_PROJECT_ID`, and credentials only from `CS_ADMIN_PROJECT_ID`, `CS_ADMIN_CLIENT_EMAIL`, `CS_ADMIN_PRIVATE_KEY` (no file, no `FIREBASE_ADMIN_*`). It writes ONE draft, `platformChangelog/v2-0-0-draft`, plus one audit entry, with `create()` in one batch: no reads, never replaces. Times are epoch milliseconds like the other entries. `createdBy` and the audit actor are "seed-script" (neither the validator nor the audit helper requires a real uid).

## Commands (PowerShell)
Dry run (no credentials; use the real release date):
`npm run changelog:seed-v2 -- --date=2026-11-20`
Apply (only once the daily quota is healthy; set the three variables in a FRESH window, never in a file):
`$env:CS_ADMIN_PROJECT_ID="<id>"; $env:CS_ADMIN_CLIENT_EMAIL="<service account email>"; $env:CS_ADMIN_PRIVATE_KEY="<key>"`
`npm run changelog:seed-v2 -- --date=2026-11-20 --apply --confirm-project=<id>`
Then close that window. If the id exists the write is refused; edit the draft in the Changelog tab instead.

## Where it shows, and publishing
Admin Panel > Changelog (owner only, in both programs), listed as a Draft. Open it, check the items, change the date if needed, then Publish. The "Posted" time is stamped at publish. The draft is invisible to everyone else until then.

## Template button
"Start from the v2.0.0 template" in that tab fills a NEW entry form with the same text (nothing saved until Save; it can make a second draft next to the seeded one). The button only reaches production with the next release; the script does not need that.

## Wording
No item was changed from the approved text. Compared with the first draft, the approved text dropped Accuracy Verification, the Judge Book card and the "EPA" claim, and moved Form Builder and All Events to Improved (per the verification report).

## Items with no proof file
Redesign (nothing single to point at) and "the Blue Alliance key page and three Admin cards are gone" (an absence). Removed items' proofs show the current state; the removals were proved against `live-before-v2` in the Phase 1 report. Field Teams has a proof file but was never opened in a browser; nothing in this release was.

## Verify (clean worktree of `release-prep`)
`npm run lint`: 0 errors, 0 warnings. `npm test`: 327 files, 4168 tests, 0 failed (new: template 9 tests, seed 11). `npm run build` with Turbopack would not resolve a junctioned `node_modules`, so I built with `next build --webpack`: passes; `check:themes` passes. A first run in the shared checkout showed 3 failures that came from another session's uncommitted membership files, not from this work.

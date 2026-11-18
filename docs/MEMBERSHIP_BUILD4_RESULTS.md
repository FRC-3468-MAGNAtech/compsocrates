# Memberships build 4: results (account deletion: a server job, resumable, budgeted, kill-switched)

Branch `release-prep`. Nothing was deployed or run against a real project. No rules change and no client write path: every step is the Admin SDK. Not legal advice: FIRST teams include minors, so the owner confirms retention and deletion with adult leads and the school or organization BEFORE turning it ON. The app says only "your team's policy applies".

## What exists
- `lib/server/account-deletion/`: `job.ts` (steps, guards, start, run, sweep), `engine.ts` (runs the registry, budget), `ports.ts` + `admin-adapters.ts` (the only Admin SDK file) + `test-support.ts` (in-memory Firestore, Auth, Blob with failure injection), `handlers.ts` + `wire.ts` (routes). Steps: disable + revoke tokens, 70 min cooldown, rewrite, end memberships, delete, avatars, sweep, delete the Auth user, delete the job. Defaults: 3,000 writes and 4,000 reads per run; 20 s deadline (504, progress kept); quota code 8 = 503 `quota_exceeded`.
- `lib/deletion/registry.ts` (`PERSON_DATA_REGISTRY`, about 50 shared rows, plus each program's own list in `data/cs/` and `lib/ftc/`) and `registry.test.ts` (fails on an unregistered collection from `firestore.rules` or the path helpers, and on a person-looking key no row lists; allowlist of field and reason). Live CS fields came from the reference code: `manualFlaggedBy`, team-document `versionReleases[]` and legacy `versionReleases`, `formPresets` (no person).
- Routes: `POST /api/account/delete` (recent sign-in, typed DELETE), `POST /api/platform/account-deletions` (list, start, resume by opaque id), `GET /api/cron/account-deletions` (second daily entry in `vercel.json`, Hobby plan: once a day, inexact). All 404 `deletion_disabled` while OFF. UI: Account Settings "Delete account" dialog, Admin Panel "Account deletions" tab (both programs, platform owner), `auth/user-disabled` reads "This account is being deleted." `personName` (`lib/people/display-name.ts`) now resolves every uid lookup: "Deleted Account" for an opaque id, "Former member" otherwise, never a uid (fixed `schedule-grid`, `team-assignments-connected`, the audit and sessions filters, form history, account teams).

## Choices to know
- Rewrite runs BEFORE memberships are ended (the names a person is known by live in documents later steps replace). A membership is copied to `{teamId}_{opaque}` (its id held the uid). One opaque id for both programs. Attendance and embedded uids are one atomic write per document with a last-update precondition.
- The job document holds no name or email; the opaque id is 128 random bits and goes with the job document. Audit lines (`platformAuditLog`) carry counts and entry ids only. The finish line lists `skippedNamesakes` by collection and count: rows left because another member of the same teams has that name. Resolve those by hand.
- Late writes: a row written after the cooldown (stale admin screen, sign-in sync) is found by the sweep; the job loops back up to 3 times, then is `stalled` (tested). Two runs at once are safe (every step is idempotent) but may repeat reads.
- Presence is found through the match keys and lobby ids of the person's own sessions (saved in the job); a presence document written later at a different match is not found. Uids inside assignments, lobbies and team documents are found by a team scan.

## Not covered (owner decisions)
Template reports/imports/updates subcollections (`formTemplateSubdocs`, one per template, not scanned); free-form `before`/`after` in audit rows; free text inside entries (comments, notes); `scoutTargets` per-scout keys; `helperReports.scoutName`; `accuracyRescouts` caller fields; legacy attendance lists holding display names; name variants in another letter case; collections only live CS writes that the reference code does not show. The old `POST /api/user/delete` is unchanged (not wired to any screen). Relink by email was not built.

## Where data may persist outside the app (tell adult leads)
Firestore exports (`npm run export:firestore`, files outside the repo), any Firebase backups or point-in-time recovery, admins' own CSV and backup exports, Vercel runtime and request logs, emails already sent (applications, ownership transfers), push messages already delivered, browser and device caches of teammates, screenshots.

## Turn it on
Firestore console, `appSettings` > `global`: add boolean `accountDeletionEnabled = true` (about 30 s to reach every instance); optional number `accountDeletionRunBudget` (positive integer, cap 10,000; lower it on a busy day). Switch off or delete the field to pause: running jobs wait (an account already disabled stays disabled until it is ON again).

## Manual check (TEST accounts only, a throwaway account in each program)
1. Switch OFF: no dialog, no tab, the routes answer 404. 2. Create the account with entries, practice, an avatar, attendance, a join request; ON. 3. Account Settings (side by side in /frc and /ftc: identical): the dialog, wrong password, no typed word, then confirm: "Deletion in progress", signed out; sign-in says "This account is being deleted." 4. Admin Panel > Account deletions: one row, opaque id only, "Waiting (cooldown)". 5. After about 70 minutes (run the cron or press Resume): the Auth user is gone, entries show "Deleted Account", team numbers and accuracy unchanged, attendance intact, the avatar removed, the row is gone. 6. Stop a job midway (budget 50) and Resume: it finishes. 7. A last-admin account is refused with the message.

## Rollback
Switch off; revert the commits. Deleted data cannot be restored: no copy is kept. New fields and `accountDeletions` can stay.

## Verify
`npm run lint` clean; `npx tsc --noEmit` clean; `npm test` 367 files, 4671 tests pass; `npm run test:rules` 8 files, 491 tests pass (the first full run had one failure in the ownership-transfer emulator test, unrelated code; it passed alone and in a second full run); `npm run build` OK. On this branch the brand guard already failed before this work (three Build 3 server files unlisted); they are allowlisted with reasons.

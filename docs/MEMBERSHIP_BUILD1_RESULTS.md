# Memberships build 1: results (data model, rules, switch route, kill switch, backfill; no UI)

Branch `membership` (from `dev` = `origin/main` + the release facts doc). Nothing was deployed, run against a real project, or merged. Rules are written, not deployed.

## What exists
- Model: `lib/memberships/model.ts` (pure), `lib/server/memberships.ts` (`ensureMembership`, `switchActiveTeam`, sign-in hook), `ProgramConfig.membership` (`defaultJoinRole` = "match-scout" from `DEFAULT_ROLE_ID`, per-program user-field map), `MAX_ACTIVE_MEMBERSHIPS = 5` (per account, both programs together).
- Route `POST /api/team/switch { program, teamId }` (`lib/server/team-switch.ts`): kill switch, program required (400), rate limit, audit entry `switch-team`, quota error (code 8) = 503 `quota_exceeded`, no credentials = 503 `server_not_configured`.
- Sign-in sync (`/api/auth/sync-roles`) calls `ensureMembershipsOnSignIn` after its own work: never throws, cannot change the answer, OFF costs the cached switch read only, ON skips an (uid, program) it ensured in the last ~10 minutes. The platform-owner attach is untouched.
- Rules (`firestore.rules`, additive, NOT deployed), `useAccountState()` (`lib/account-state.ts`, no consumer), `scripts/backfill-memberships.ts` (never run). Test-only: the fake Firestore got atomic transactions, `injectCommitFailure` and `FieldValue.delete()`.

## New collections and fields (person data for the later deletion session)
- `memberships/{teamId}_{uid}` and `programs/ftc/memberships/{teamId}_{uid}`: `uid`, `teamId`, `role`, `roles`, `secondaryRoles`, `isAdmin`, `isOwner`, `fieldTeamIds` (null where absent or not a field of the program), `name` (display-name snapshot, no email), `status` active|past, `origin` pointer|verified, `joinedAt`, `leftAt`, `updatedAt` (epoch ms), `endedBy`. Deletion: end as `deleted`, rewrite `uid` and `name`.
- `appSettings/global.membershipsEnabled` (missing = OFF). No existing field or rule changed.

## Turn it on (kill switch)
In the Firestore console open `appSettings` > `global` and add the boolean `membershipsEnabled = true`; set it to `false` or delete it to stop. Instances cache the answer for about 30 seconds. OFF: sign-in creates nothing, the route answers 404 `memberships_disabled`, the backfill refuses `--apply`. `useAccountState()` works either way (it falls back to one implicit membership).

## Rules to deploy by hand (additive; save the live ruleset first)
Console > Firestore > Rules: copy the live ruleset somewhere safe, then publish `firestore.rules`. Compare it with the live rules first (see `docs/SECURITY-NOTES.md` section 3a: this file has other additions than memberships). The new blocks only add `memberships` (root) and `programs/ftc/memberships`. Order: rules can ship before the app. If the app ships first, `useAccountState()` falls back on permission-denied (tested).

## Backfill (PowerShell; there is NO staging project, so this runs on production)
Take a managed Firestore export first (the export script reads documents and costs quota). Set the three variables in a fresh shell (never in a file; `vite-node` also loads `.env*` for variables that are not set), check the project and account it prints:
- `$env:CS_ADMIN_PROJECT_ID="<id>"; $env:CS_ADMIN_CLIENT_EMAIL="<sa email>"; $env:CS_ADMIN_PRIVATE_KEY="<key, \n escapes>"`
- Dry run (counts only, a few reads): `npm run backfill:memberships` ; with per-team lists, missing teams, over-limit and bad-id users (reads documents): `npm run backfill:memberships -- --detail`
- Set `membershipsEnabled` to true. One small team (the owner's own FRC team): `npm run backfill:memberships -- --apply --confirm-project=<id> --program=frc --team=<TEAMCODE> --max=200`. Open the new documents in the console and check the fields.
- The rest: `npm run backfill:memberships -- --apply --confirm-project=<id>` (repeat after a midnight-Pacific quota reset if a cap stops it; it is create-only and resumes). Caps: `--max-writes` 5000, daily write ceiling 10000, `--max-reads` 20000, daily read ceiling 25000. A pointer at a team document that does not exist (legacy lower-case codes may show up here) is reported and skipped.

## Manual check (no UI; switching cannot be exercised end to end in production yet, the tests cover it)
Export, dry run, apply for the owner's team, set the switch true, sign in as the owner on a Preview deployment: nothing in the app changes and a membership document exists for the owner's team. A pointer-only account still works. Set the switch false: sign-in no longer creates memberships.

## What remains exposed because of CS-OPEN (unchanged, not made worse)
The root `users/{uid}` can still be written by its owner, including `teamId`, `role` and `isTeamAdmin`, so a forged pointer still reads that team's active data and roster as before. Memberships add no client write path and do not fix this. A pointer-origin membership never opens the past roster (tested with a forged `teamId` plus admin flag). The switch route snapshots a forged pointer into a pointer-origin membership at worst. FTC pointers are locked by its rules.

## Rollback
Revert the commits. The new collections can stay (nothing existing reads them); delete `membershipsEnabled` or set it false to stop all server behavior first.

## Verify (all run once on this branch)
`npm run lint` clean; `npx tsc --noEmit` clean; `npm test` 333 files, 4285 tests pass; `npm run test:rules` 7 files, 475 tests pass (Java 21, CLI 15.34.1); `npm run build` OK. Unrelated failures: none.

## Left for the next sessions
Join, leave, removal and approval flows and the verified memberships (build session 2), the roster seam, no-team routing and personal practice, the switcher UI, role-choice toggle, applications, account deletion, hardening `sameTeam()` after the backfill.

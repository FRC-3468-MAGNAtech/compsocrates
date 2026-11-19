# One team switcher, My teams across programs, no-id labels: results

Branch `release-prep`. Nothing deployed or run against a real project; no rules change. Mocks and the emulator only.

## What exists
- ONE `TeamSwitcher` (`components/team/team-switcher.tsx`, pure model `team-switcher-model.ts`) in the sidebar, drawer and top bar; `FieldTeamSwitcher` is deleted. Trigger: program badge, number bold, name beneath, wrapping (the selected robot team for a team with several). Panel: both programs' teams grouped by program, the active team's robot teams ("View as", local only), "Join another team"; a bottom sheet on phones, a `FloatingPanel` at the trigger's width elsewhere. Switch OFF: only the robot choice, only with two or more. The dashboard's duplicate FRC|FTC pill is removed.
- Cross-program switch: same route with that program, hold until that program's profile shows the team (`confirmPointer`), then `/<program>/dashboard`. 409 `no_profile`: inline notice, no navigation.
- `lib/team-label.ts` (`resolveTeamLabel`) is the only label helper: it takes a number and a name, an id is passed only to be dropped, nothing known = skeleton / "Team (loading)". Order: live team, membership snapshot, older `teamLabel`, device cache (`lib/team-label-cache.ts`, cleared on sign-out). Tests render first paint, old memberships, other programs and a failed read with a known id and assert it never appears.
- Memberships get `teamNumber` / `teamName` (strings, so "35792 + 35794" fits; `accountName` wins as the name), written by server code only: verified flows always, switch route and sign-in sync when missing. Not personal data (registry note).
- My teams: every team of both programs, badge, two-line label, role, Owner / Active badges, Leave per row's program; the active team's robot teams under its row with a Team Settings link.
- Team Settings: admin-only "Organization name" (`accountName`, 60 chars; both programs' rules already allow it). Past Team Members: a platform owner gets a link to `/admin?tab=verify-admins` (the admin page now opens `?tab=`).

## Reads added (all metered, none per page load, no listeners)
1. Other program's memberships: once per session on the first panel open or My teams mount, `uid ==`, at most 5 documents; again after a switch, leave or join (`refreshAccountState`).
2. Cross-program switch: one `getDoc` of that program's user document (up to 3 tries) per switch.
3. Server: one team-document read per membership, once, in the sign-in sync and switch route when the snapshot is missing (the sync is cached ~10 min per instance).

## Known limits (reported, not changed)
- A snapshot is written once, so a renamed team or a newly set organization name shows on other members' rows only after the live team document is seen (the active team is always live; other rows use the device cache then the snapshot). The browser cannot tell the OTHER program's active team, so "Active" shows only for the current program's.
- Robot teams are listed only under the active team's row (the others' team documents are not readable). With one robot team there is no "View as".

## Manual check (preview, TEST accounts, switch ON)
1. /frc and /ftc side by side: one dropdown in the sidebar, drawer and top bar, text wraps, nothing off screen, no id on first load (hard reload, throttle the network).
2. FTC team with two robot teams: trigger shows the selected one, "View as" switches it with no network call.
3. Open the panel: both programs' teams; choose the other program's team: "Switching…", then that program's dashboard on that team.
4. A membership with no profile in that program: the notice, no navigation.
5. Account Settings > My teams lists FRC and FTC rows; Leave works per row.
6. Team Settings: set and clear the organization name.
7. Platform owner: Past Team Members hint shows the link.
8. Switch OFF: only the robot picker, only with 2+ robot teams.

## Rollback
Switch off (`membershipsEnabled`) for the switcher, My teams and the snapshot writes; or `git revert` the commits (label helper, snapshot, switcher, My teams, hint, organization name). The new membership fields can stay.

## Verify
`npm run lint` clean (no errors; the one `jsx-ast-utils` notice is old). `npx tsc --noEmit` clean. `npm test`: 386 files, 4,812 of 4,813 passed on the full run; the one failure (deletion-registry heuristic flagged `accountName`) was fixed by listing it as a non-person field, and that file plus the brand and parity guards were re-run and pass (the whole suite was not run again). `npm run test:rules` (Java 21, FTC rules file with its 90 s hook timeout): 8 files, 492 tests pass. `npm run build` OK. Unrelated failures: none.

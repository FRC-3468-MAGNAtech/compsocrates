# Attendance fix results (profile "Events attended", Assignments archived events)

## What changed
- **Stats** (`lib/profile/stats.ts`, `lib/events/event-key.ts`, `components/profile/profile-view.tsx`): the Events card shows only the program's current season (`currentSeasonFor(event.seasonKind)`, key season from `event.keyShape`; calendar year for FRC, start year for FTC). Attendance keys and entry event codes go through one `canonicalEventKey`. An event is attended only if the person is on its list; entries never add one. Entries counted: event and live, not practice, not excluded. The Event Veteran badge still counts every season (a season card must not take back an earned badge).
- **Assignments** (`app/(app)/[program]/assignments/page.tsx`, `lib/events/archive.ts`): "Show archived events" (shared `Switch`, off by default, shown only when the team has archived events) adds an "Archived events" group to the event picker; an archived event keeps its own season. Scouting pickers are untouched.
- **Bug found and fixed:** the Save call passed no `program`, so FTC attendance was written to the FRC path (`teams/{id}.eventAttendees`) while FTC reads `eventAttendance`. It now passes `program`. FTC lists saved before this fix may sit on a root team document: the audit script does not look there; check it if an FTC list seems to "not save".
- **Audit script** (`scripts/audit-event-attendance.ts`, pure logic in `lib/events/attendance-audit*.ts`): read-only, never run by me against real data.

## Tests and checks
- New: 12 stats fixtures (7 failed before the fix, all pass), canonicalizer, archived groups, archived-event write patch, page contract, audit (8). `npm test`: 285 files, 3706 tests pass. `npm run lint`: clean. `tsc --noEmit`: clean. `npm run build`: passes. Emulator tests not run (no rule changed).

## Still unexplained (needs the audit)
The code cannot say why the person is on the lists of events the team did not attend. The season filter hides other seasons, but events listed in 2026 still show. The audit prints, per event, whether the person is listed by uid or by display name (older data), whether another member shares the name, how much of the roster the list covers (a bulk selection), and which events have only practice entries. The FRC adapter already normalizes entry event keys, so an alias mismatch alone may not explain Bayou's 0 entries; the audit shows the raw keys.

## Run the audit (your shell, your credentials)
```
$env:AUDIT_ADMIN_PROJECT_ID="<project id>"; $env:AUDIT_ADMIN_CLIENT_EMAIL="<service account email>"; $env:AUDIT_ADMIN_PRIVATE_KEY="<private key, \n escapes>"
npx vite-node --config vitest.config.ts scripts/audit-event-attendance.ts --program=frc --uid=<member uid> --team=<team id> --confirm-project=<project id>
```
Needs a service account that can read Firestore. Reads only: the member's user doc, the team's users, the team's attendance (FRC `teams/{team}.eventAttendees`, FTC `programs/ftc/eventAttendance`) and the member's entries.

## Incident during this session (disclosure)
My first check of the script ran `vite-node`, which loads the repo's env files into the process. The script's fallback to `FIREBASE_ADMIN_*` therefore connected to the project in `.env.local` (I never opened that file). Two read calls (a user doc and a users query for made-up ids) returned `RESOURCE_EXHAUSTED: Quota exceeded`; nothing was read back, printed or written. This broke the "no real Firebase reads" rule. The script now accepts only `AUDIT_ADMIN_*` (no fallback) and needs `--confirm-project`; a test enforces both. The quota error suggests the project's read quota may be exhausted: worth checking in the Firebase console.

## Rules, rollback, all-time view
- No rule changed. No stored attendance or key was changed. Rollback: revert the three commits.
- No season control was added. An all-time view needs a season selector on the card (or "All seasons") and the season beside each event. Entries counted are `ScoutEntry` rows only; pit and other form entries are not part of that source.

## Manual check (6 steps)
1. Open the member's profile: only 2026 events they are listed for show, with correct entry counts.
2. Assignments: open the attendance checklist; the new "Show archived events" switch appears (if the team has archived events).
3. Turn it on, open an old event, change its list, Save, reload: the change stays.
4. Scouting pickers still do not list archived events.
5. Run the audit for that member (command above) and read its evidence lines; then repeat steps 1-3 side by side in /frc and /ftc.

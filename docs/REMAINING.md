# What is not done, and known gaps

The current state, kept short. "Not verified" means it was built and unit tested but never run in a browser or against the real services. Security findings about CompSocrates's (CS) Firestore rules and server routes are in `docs/SECURITY-NOTES.md` (local only, not for a public repository).

## Not verified (needs a person with a browser and credentials)
- **No page has been opened in a browser.** The build and the unit and emulator tests pass (as last recorded), but the pages were not compared with the live CS app on screen and the browser console was not checked. Do this first: `npm run dev` with a staging Firebase project, `.env.local` filled in, and the emulators or a copy of the CS data. The four core pages are Event Select, Dashboard, Match Scout Form and Match Scout Analytics.
- **Phone testing.** The 44px targets, draft restore, timer controls and offline submit follow the mobile spec (`docs/MOBILE.md`) but were not tried on a real phone with a dropped connection. The offline submit resolves the form as "queued" when the browser is offline or after 8 seconds; check it feels right in the stands.
- **Playwright specs were not run** (they need `npx playwright install chromium webkit`). The fixtures behind them were rewritten when the games became config entries, so expect some updates on the first run.
- **Live APIs.** TBA, the FIRST FRC API and Statbotics were only exercised through mocked `fetch`. The FIRST FRC API's playoff match numbering was not confirmed to match decision D11, so playoff matches come from TBA only (no FIRST fallback).
- **Never run against a real Firebase project** (decision D2). Sign-in providers, the Admin credentials, push notifications, Blob uploads and the cron poller are untested end to end.

## Test status
- **Run on 2026-11-14 at `9a31aca` (clean tree):** `npm run lint` passes (one `jsx-ast-utils` notice); `npm test` 2777 of 2777 passed (180 files); `npm run build` passes (theme guard 434 checks, 37 static pages); **`npm run test:rules` fails: 267 of 288 passed, 21 failed, all in `data/cs/adapter.emulator.test.ts`.**
  - Cause: every one of the 21 throws `TypeError: Cannot read properties of null (reading 'useContext')`. That file runs hooks in its own hook runtime (`vi.mock("react")` replaces `useState`, `useEffect`, `useMemo`, `useCallback`, `useRef`, `useSyncExternalStore`) and does not replace `useContext`. Since `f539c72` and `d29bafc` the shared hooks call `useProgram()` / `useProgramConfig()` (`lib/program/context.tsx`), which calls `useContext`, so they run against real React with no dispatcher. A test-harness gap from the program work, not an app bug and not a timing flake. It affects the sections on scouting reads, users and teams, form entries, assignments and sub-ins (including the old "cancel" test). Not fixed yet.
  - The rules file, the API-route tests and `data/ftc/rules.emulator.test.ts` all pass (including the new `inFtcProgram` tests).
- Before that, the last recorded full pass was the commit that added the adapter integration tests: 2392 unit and 247 emulator tests. Seven commits after it (shared env module, brand config, removal of the second provider and the multi-team model, event-name chain, games as config entries) did not record a run.
- The per-game cases (`data/cs/per-game.test.ts` for unit, and the REEFSCAPE and CHARGED UP read and write cases in `data/cs/adapter.emulator.test.ts`) were written with the games-as-config change. Their run status is not recorded.
- **Run before release:** `npm run lint`, `npm test`, `npm run test:rules` (needs Java and the Firebase CLI) and `npm run build`.

## For the CompSocrates and sister-app merge
- **Multi-team accounts are not supported.** One team per team document, read through `lib/our-team.ts` (`useOurTeam`, `useIsOurTeam`, `OurTeamProvider`), is the single seam a later team switcher plugs into (decision D13). The old multi-team implementation is preserved in the git tag `pre-ce-removal`. Leftover multi-team fields on user and team docs are left untouched: never read, never deleted.
- **Brand config** (`config/brand.ts`) is where a merged product name, storage prefix and logo would be set (D15).

## Needs official artwork
- **No logo exists beyond the favicon.** Navigation, login and loading screens show the text name; the web app manifest lists no icons; there is no iOS home-screen icon and no social preview image.
- **Install prompt and iOS icon:** Chrome offers "install" only when the manifest has a 192px and a 512px PNG icon, and iOS needs a 180px Apple touch icon. Put the files under `public/` and set the slots in `config/brand.ts`: `mark`, `markDark`, `apple` (180x180), `pwa192`, `pwa512`, `pwaMaskable512` and `og` (1200x630). The manifest, metadata and the places that show the mark pick them up with no other change.

## Configuration caveats
- **`NEXT_PUBLIC_TBA_API_KEY` is misleadingly named.** It keeps CS's variable name so existing environments work, but it is a secret: it is read only on the server (`lib/server/env.ts`) and no client code may reference it, or Next would inline it into the browser bundle. Do not add a client reference. See `docs/ENVIRONMENT.md`.
- A few optional-service modules still read `process.env` directly instead of `lib/server/env.ts` (outgoing email, the Turnstile check, the application secret, the Blob routes). Behavior is the same; moving them in would make `missingEnv()` and the Setup Check the only readers.

## Owner decisions (functional gaps in the rules)
- **Pick-list editors other than team admins cannot save.** CS's production rules let only team admins write `teams/{id}`, but the app (and CS's own permission list) also names lead-strategist, lead-scout, team-coach and drive-team as pick-list editors. `editPickList` by one of them is denied by the rules, and a test asserts the denial. Fixing it needs a field-scoped rule for `teams.pickList`, which changes CS's rules, so it was not done.
- **`teamAssignments` has no rule in CS**, so clients can neither read nor write it. As in CS, team-strategy assignments are written to the `matchAssignments` mirror, which works.
- **Collections CS's rules do not cover** (`scoutingFlagStates`, `teamAnnouncements`, legacy `judgeBookCards` and `versionReleases`) get blocks in the rebuild's `firestore.rules`. Compare with the live rules before deploying.
- Edits rewrite derived fields, matching CS's own behavior: a values edit rewrites `auto.estimatedFuel`, and a lead-scout edit rewrites `timestamp` along with `submittedAt`.
- `useFormEntries` reports `loaded` as soon as its first collection answers, so a list can briefly show partial data.

## Parity gaps (CS does it, the rebuild does not yet)
**Match Scout Form**
- Auto-selecting the next match on open: the rebuild shows a "Next assignment" banner with a Load button (and the `?load=next` link). CS's fallbacks when you have no assignment (first incomplete match, else next scheduled) are not ported.
- CS's `?editId&editCollection` deep link into the form (the rebuild edits through the Admin entry editor).
- The finals bracket picker has no Scouted/Assigned marks (the practice and qualification lists do).
- "Scouted" checks use the team's own entries; CS read every team's rows for the event.
- Device notifications for new sub-in requests.
- Match-list scouted marks do not include lead, strategy-plan or drive-reflection completions.

**Other forms**
- Match Strategy prediction prefill (the hook point is documented in `lib/forms/builtin-rebuilt-forms.ts`), the lead form's auto-fill of robot team numbers from the chosen alliance, CS's pit-sync warnings on the strategy and drive forms, and digits-only filtering on number text fields.
- Drive reflection roles use CS's list (cycler, passer, shooter, stealer), which differs from match strategy's (Offense, Defense, Feeder), so role is not compared between a plan and its reflection.

**Practice sessions and library**
- `/practice-scouting` does not read the `rescoutId`, `matchKey`, `teamNumber`, `alliance` and event parameters that the Accuracy Verification "Re-scout" button navigates with.
- Practice sessions written by the rebuild do not carry CS's embedded `scoutedData` / `allScoutedData` / `scoringWeights` (the values live in the linked `scouting` rows), so CS pages that read the embedded data will not see them.
- CS's live-lobby documents (stored inside `practiceSessions`) are skipped; the rebuild keeps its own `lobbies` and `liveMatches`.
- Admin library tables show only the rebuild's own `libraryMatches`; CS's imported `practiceMatches` appear read-only in the scout-facing lists.

**Analytics and events**
- Event details has no "Event Type" or "Week" (the API types carry neither). Its Schedule and Rankings tabs go beyond CS, which showed a "coming soon" card there.
- The Climb Reliability box plot needs `endgame.attemptedClimb`, which no CS form ever wrote, so it always says no attempts (same as CS).
- Match prediction, radar and compare skip entries of games whose plugin cannot rebuild a CS document, with a message.
- Thresholds that belong in `config/games` are still constants in `lib/analytics/` (`TOWER_POWER`, `HIGH_ACCURACY_MIN`, `RESCOUT_COMPARE_MIN_ACCURACY`, `CRITICAL_DIFF_PERCENT`, `LEAD_ROWS_SHOWN`, `SECTION_PREVIEW`).

**Admin, release notes, account**
- The two Admin ID tools are Admin Panel tabs, but the old URLs redirect to plain `/admin` because the panel's tabs are local state (no `?tab=`).
- Release notes: CS's `versionReleases` notes (title and free-text body, editable by team admins, a `canManageVersionReleases` flag or the owner allowlist) do not appear in the app's changelog. That needs a one-time import or a read adapter.
- CS `form-builder` presets (the `formPresets` collection, REEFSCAPE-only) are not read; the Admin Panel's form builder replaces it.
- No "delete my account" button yet; the server route (`POST /api/user/delete`) and client helper (`deleteMyAccountData` in `lib/join-requests-client.ts`) exist but are not wired into the account page.
- Not audited: CS's cookie-consent banner and profile-picture upload on the account page.

## Data caveats
- Older or imported CS rows can lack `teamId`. Team-wide reads add a fallback (by member `scoutId` / `scoutName`), but event-scoped reads do not, so those rows are invisible there.
- Docs with no `eventKey` (all legacy helper reports, some old entries) read as event `""` and vanish from event-filtered views. CS inferred the event from timestamps; the rebuild does not.
- A CS match id `f1` is ambiguous (finals game 1, or bracket slot 1 from CS's bracket picker). The adapter reads `f1` to `f3` as finals games (14 to 16).
- CS keeps one manual flag per entry and one `dismissed` boolean; the app can hold several. The last manual flag is written in CS's shape and the rest travel in the additive `manualReasonText` / `manualNoteText` fields.
- A manually flagged CS entry is treated as excluded from stats by CS, but the rebuild's `excluded` means `excludeFromStats` only, so some stats can differ.
- The pick list is one list per team (as in CS), not per event.

## Additive fields the app writes
Harmless to CS (it ignores them) but not part of CS's schema. Drop them if the schema freeze must be absolute.
- `users/{uid}`: `isOwner`, `isPlatformOwner`, and the theme and preference fields (`themeId`, `colorMode`, `gradientIntensity`, avatar, `lastSeenChangelogAt`, `fcmTokens`, workspace preferences and similar).
- `teams/{id}`: `selectedEventNames` (`{ [eventKey]: name }`, written by Event Select beside `selectedEvents` with a merge write so event names survive a data-API outage; read in `data/cs/teams.ts`, the "stored" step of the name chain in `lib/events/names.ts`).
- `teams/{id}` (FRC) and `programs/ftc/teams/{id}` (FTC): `archivedEvents` (`string[]` of event codes, Session D; written by Event Select with a merge write / `updateDoc` of that one field, admins and owners only; read in `data/cs/teams.ts` and `data/ftc/teams.ts`). Archived codes stay in `selectedEvents`; only the event pickers skip them. No data read is filtered by it.
- `teams/{id}` (FRC) and the second program's team doc: `formSubmissionSettings` (`{ enabled: boolean, seasons: { [seasonId]: boolean }, updatedBy?: { uid, name }, updatedAtMs?: number }`, Session E; written by Admin Panel > Form Submissions with a merge write / `updateDoc` of that one field, admins and owners by the rules). Missing means every form is open. A client-side control: the rules do not enforce it (`lib/forms/submission-guard.ts`).
- `scoutingFlagStates`: `manualReasonText` and `manualNoteText` (the extra manual-flag reason and note).
- Entries and form docs: `stickyNotes` (and `linkedEntryId`, `planDifferences` where a form has them); `alliance` on match-strategy plan and drive-reflection docs; `eventKey` on helper docs; `teleop.humanPlayerFuelByShift` on REBUILT entries (D8).
- FTC entries: `values.allianceRole` (`hive` or `garden`) on BIOBUZZ match entries; the other role's fields are absent, not 0.
- A new `subInRequests` collection (D7).
- `teams/{id}/settings/sidebar` (FRC) and `programs/ftc/teams/{id}/settings/sidebar` (FTC), Session F: a new settings doc beside `pageAccess` (`{ version: 1, rev, entries: [{ id, kind, parent, order, label?, icon?, hidden? }], updatedBy, updatedAt }`). Read by every team member, written by team admins only, each save `rev + 1`; shape and size checked by `validSidebarDoc` / `ftc_validSidebarDoc` in `firestore.rules` (written to the file, NOT deployed). The `edit-sidebar` audit action is a new value of an existing free-form field. No existing field changed.
- FTC only (`programs/ftc/`): `teams/{CODE}` (id is an 8-character random join code) carries an optional `location`; new `teams/{CODE}/joinRequests/{uid}` (`uid`, `name`, `status`, `createdAt`). Rules for both are written in `firestore.rules` and NOT deployed.

## Program merge (docs/MERGE_PLAN.md)
- **FTC program status** (D22; the connected paths are `connection.paths` in `config/programs/ftc.ts`; `pagesConnected` is true and any other path shows `UnconnectedPage`). Shared pages reach FTC data through the port (`lib/program/data.ts`, `lib/ftc/program-data.ts`, over `data/ftc/`) or a store that builds its path with `programPath`.
  - **Connected:**
    - Scouting: the scout page, Active Events, Match List, Assignments (match, pit and team-strategy schedules: publish, undo and slot edits for an admin or lead scout; the shell's assignment watcher and the scout page prompt are on).
    - Forms: the six other form pages and their analytics tables.
    - People and team: Dashboard, My Scouting, People, Team Management, Account, Profile, Credits.
    - Analytics: Match Scout, Pick List, Scout Status, Match Breakdown, Teams (team profile), Team Averages, Team Breakdown, Rankings.
    - Features on: `assignments`, `pickList`.
  - **Not connected (shows the notice):**
    - Scout Accuracy and Practice Scouting (no FTC data layer).
    - The single-event page `/events/[eventKey]` (its season is derived from the FRC key prefix).
    - Team Settings (field teams, active forms) and Admin.
    - Changelog: its starter entries describe the FRC app, so FTC needs its own seed text, and the `users` rule must allow `lastSeenChangelogAt`.
    - Features off, so the parts they cover are hidden: sub-ins, practice, live, library, accuracy (post-save accuracy, "Recalculate Accuracy"), CSV import, changelog, applications, join requests, announcements, event lookup.
    - The six FRC-only pages stay greyed out (listed below).
  - **Known gaps:**
    - Setup (Session A, `docs/SESSION_A_RESULTS.md`): an FTC person with no profile now gets a create-a-team / request-to-join screen in the gate (`components/program/team-setup.tsx`, port `enrollment`). Not built: the approval of a join request (needs a rule letting a team admin create the applicant's profile, plus a Team Management panel; `features.joinRequests` stays off), showing a pending request again after a reload, adding more teams to an account from Settings, and any announcement UI. Team creation has no `appSettings` gate (the FTC rules and code never used one).
    - Multi-team: the switcher and `lib/our-team.ts` work (`accountTeams`, `assignedTeamIds`). Not built: adding, renaming or removing an account's teams and assigning members (Settings), filtering events or entries by the selected team (entries belong to the account, not a team), and a check against real multi-team accounts.
    - A failed read in the shared hooks still shows an empty list (reported to the console; the port passes the `FirestoreFailure` through for a page to show).
    - Event and team names, schedules, match pickers and photos need FTC Events API credentials and Blob config; without them the pickers fall back to manual entry.
    - Schema v1 FTC entries (typed `fields`, no `values`) read as keyed values, but whether they resolve to a form (their `formId` may be empty) is unchecked against real data.
    - Reconstructions, not production facts: the FTC playoff numbering and the `ft-<n>` fallback team id.
  - **FTC game and forms:** BIOBUZZ is ported (`config/games/ftc/`, D21) and the six non-match built-in forms are copied from the sister app (`lib/ftc/forms/`). The golden documents are shape-faithful fixtures, not copies of production entries (check a few real ones after the migration dry run). Incident fields are toggles, not checkboxes. Not re-checked since the program-aware work: whether `game:<id>` custom scorers resolve outside the default registry, and whether the analytics difficulty thresholds (`lib/difficulty.ts`) pick by program.
  - **Not verified:** no FTC page has been opened in a browser. The data layer (save, edit, delete, every query, assignments, credits) is checked against the real FTC rules in the emulator (`data/ftc/rules.emulator.test.ts`, in `npm run test:rules`).
  - **Repo state:** `npm run lint` passes but prints a `jsx-ast-utils` notice ("expression type of TSNonNullExpression could not be resolved"); it does not come from the assignments files, and whether it predates the program work was not checked (no cheap way without a second install). The `.gitignore` credential patterns and the `get` guard on the root `scouts` / `players` wildcards (`inFtcProgram`) with their tests were already committed in `9a31aca`; reviewed on 2026-11-14, the diff holds nothing else and no secrets. The working tree is clean.
- Run the migration script (`scripts/migrate-ce-to-ftc.ts`) as a dry run, review, then apply; deploy the rules and indexes by hand after review. Needs the sister project's Auth export and hash parameters.
- FRC-only pages for FTC (greyed out now): accuracy-compare, accuracy-verification, match-prediction, performance-reliability, robot-radar, judge-book.
- Unverified: FTC playoff bracket slot numbers, the FTC Events API against live keys, the Auth import (`importUsers`) path.
- **Pre-deploy review of the rules and indexes (2026-11-14); nothing deployed.**
  - `firestore.rules` differs from `docs/cs-firestore.rules` by much more than the FTC block: new helpers, two `teams/{id}/*` subcollections, about 600 lines of root collections and two root wildcard rules. Deploying changes live FRC access, not just FTC. Details and the wildcard finding are in `docs/SECURITY-NOTES.md` section 3a.
  - `docs/cs-firestore.rules` is a pasted copy and was not compared with the live rules. Do that in the console first. It is also the rollback source.
  - Open: a residual cross-program read through the root collection-group queries if an FTC `teamId` equals an FRC team code. FTC team-id format unchecked against live data.
  - Indexes: `firestore.indexes.json` equals CE's file (four `practiceSessions` / `formEntries` composites plus the `scouts` / `players` overrides). No query found in the CE reference needs a composite index (no `orderBy`; filters are equality or single-field `array-contains`), so the composites are unused but harmless. The live index list is unknown: export it first (`firebase firestore:indexes --project compsocrates`), answer no to any delete prompt and never use `--force`.
  - Deploy dry run (`firebase deploy --only firestore:rules --project compsocrates --dry-run`) was not run: it contacts production, and the CLI was signed in as a different account than the project owner's. `.firebaserc` defaults to the demo project, so always pass `--project`.
  - `npm run test:rules` earlier on 2026-11-14 recorded 252 of 253 (one sub-in "cancel" failure, thought to be a timing flake). Superseded by the run in "Test status" below.
  - **Docs and tree reconciled (2026-11-14, `docs/STEP1_RESULTS.md`).** `data/ftc/` is in the repo (24 tracked files) and committed on branch `rebuild`; `pagesConnected` is true for both FRC and FTC, and the connected-pages list above matches `connection.paths`. The earlier "no `data/ftc/`" note came from looking in the wrong folder (the repo is `CompSocrates rebuild/`, inside `compsocrates-rebuild/`), not from lost work.

## Cleanup left
- Mixed LF and CRLF line endings across files (git warns on commit). Normalise with a `.gitattributes` when convenient.
- `npm audit` and dependency upgrades.

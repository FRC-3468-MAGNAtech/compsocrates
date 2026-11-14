# What is not done, and known gaps

The current state, kept short. "Not verified" means it was built and unit tested but never run in a browser or against the real services. Security findings about CompSocrates's (CS) Firestore rules and server routes are in `docs/SECURITY-NOTES.md` (local only, not for a public repository).

## Not verified (needs a person with a browser and credentials)
- **No page has been opened in a browser.** The build and the unit and emulator tests pass (as last recorded), but the pages were not compared with the live CS app on screen and the browser console was not checked. Do this first: `npm run dev` with a staging Firebase project, `.env.local` filled in, and the emulators or a copy of the CS data. The four core pages are Event Select, Dashboard, Match Scout Form and Match Scout Analytics.
- **Phone testing.** The 44px targets, draft restore, timer controls and offline submit follow the mobile spec (`docs/MOBILE.md`) but were not tried on a real phone with a dropped connection. The offline submit resolves the form as "queued" when the browser is offline or after 8 seconds; check it feels right in the stands.
- **Playwright specs were not run** (they need `npx playwright install chromium webkit`). The fixtures behind them were rewritten when the games became config entries, so expect some updates on the first run.
- **Live APIs.** TBA, the FIRST FRC API and Statbotics were only exercised through mocked `fetch`. The FIRST FRC API's playoff match numbering was not confirmed to match decision D11, so playoff matches come from TBA only (no FIRST fallback).
- **Never run against a real Firebase project** (decision D2). Sign-in providers, the Admin credentials, push notifications, Blob uploads and the cron poller are untested end to end.

## Test status
- The last recorded full pass is the commit that added the adapter integration tests: 2392 unit and 247 emulator tests, clean lint and build. Seven commits since then (shared env module, brand config, removal of the second provider and the multi-team model, event-name chain, games as config entries) did not record a run.
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
- `scoutingFlagStates`: `manualReasonText` and `manualNoteText` (the extra manual-flag reason and note).
- Entries and form docs: `stickyNotes` (and `linkedEntryId`, `planDifferences` where a form has them); `alliance` on match-strategy plan and drive-reflection docs; `eventKey` on helper docs; `teleop.humanPlayerFuelByShift` on REBUILT entries (D8).
- A new `subInRequests` collection (D7).

## Program merge (docs/MERGE_PLAN.md)
- FTC data layer: the shared pages read FRC collections through `data/cs`, so each shared page needs a program-aware layer before it is connected (see the first-slice bullet below). `data/ftc/` has read converters and read/subscribe functions (`read.ts`) for `scoutEntries`, `formEntries`, `forms` (and versions), `teams` and `users`, plus saving a scout entry (`write.ts`). Still to do: the other write paths (edit, flag, delete entries; form entries; form publish; member and event edits), the other collections the shared pages read (`practiceSessions`, `libraryMatches` / `libraryEvents`, `assignments`, `pickLists`, `scoutTargets`, `eventAttendance`, `auditLog`, `liveMatches`, `lobbies`, `notifications`), and the port members for each page as it is connected. Known read gaps: schema v1 entries (typed `fields`, no `values`) read as keyed values, but whether they resolve to a form (their `formId` may be empty) is unchecked against real data; and `TeamMember` has no slot for a member's assigned team ids (`readMemberFieldTeamIds` returns them).
- FTC pages, first slice (D22): the scout page is connected (`connection.paths` in `config/programs/ftc.ts`; `pagesConnected` is true; other paths show `UnconnectedPage`). It reads the FTC profile, team doc, scout entries, pit form entries and forms through the data port and saves to `programs/ftc/scoutEntries`; the data layer is verified against the real FTC rules in the emulator (`data/ftc/rules.emulator.test.ts`, in `npm run test:rules`), the UI is NOT verified in a browser. Not connected, in order of the scout page's neighbours: scouting list / My Scouting, team pages (Team Breakdown, Averages, Rankings), Match List, Dashboard, Event Select and the event pages, then analytics, assignments (and the watcher, `features.assignments`), sub-ins (`features.subIns`), practice and live, library, changelog, applications, admin pages, profile and settings (`updateUserProfile` refuses under a ported program), the form pages other than match scout, and post-save accuracy (`features.accuracy`). Feature flags in `connection.features` flip to true as each gets a program-aware layer. Gaps: no setup or join flow for an FTC person with no profile (they see the gate); a failed read still shows an empty list in the hooks (reported to the console, as the root program's do; the port passes the `FirestoreFailure` through for a page to show); scout-page match and team pickers need FTC Events API credentials, otherwise manual entry; the scout page's assignment prompt and sub-in control are hidden.
- FTC multi-team accounts: the switcher and `lib/our-team.ts` are done (`accountTeams`, `assignedTeamIds`). Not done: adding, renaming or removing an account's teams and assigning members (Settings), an event or entry filter by the selected team (entries belong to the account, not a team), and a check against real multi-team accounts.
- FTC game: ported (`config/games/ftc/`, D21) with a golden test, but not wired into anything yet. Still to do: let the shared scout form, scorer (`game:<id>` custom scorers only resolve the default registry), season pickers, analytics game filter and difficulty thresholds (`lib/difficulty.ts`) choose by program; the sister app's other seven built-in forms (lead, pit, team and match strategy, drive reflection, helper) are not ported; incident fields are toggles, not checkboxes; the golden documents are shape-faithful fixtures, not copies of production entries (check a few real ones after the migration dry run).
- Run the migration script (`scripts/migrate-ce-to-ftc.ts`) as a dry run, review, then apply; deploy the rules and indexes by hand after review. Needs the sister project's Auth export and hash parameters.
- FRC-only pages for FTC (greyed out now): accuracy-compare, accuracy-verification, match-prediction, performance-reliability, robot-radar, judge-book.
- Unverified: FTC playoff bracket slot numbers, the FTC Events API against live keys, the Auth import (`importUsers`) path.

## Cleanup left
- Mixed LF and CRLF line endings across files (git warns on commit). Normalise with a `.gitattributes` when convenient.
- `npm audit` and dependency upgrades.

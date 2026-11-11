# What is not done, and known gaps

Written from the workers' own reports and the final checks. "Not verified" means it was built and unit tested but not run in a browser or against the real services.

## Not verified (needs a person with a browser and credentials)
- **No page was opened in a browser.** `npm run build` passes and unit and emulator tests pass, but the four core pages (Event Select, Dashboard, Match Scout Form, Match Scout Analytics) have not been compared side by side with CE or CS on screen, and the console has not been checked. Do this first: `npm run dev` with a staging Firebase project, `.env.local` filled in, and the emulators or a copy of the CS data.
- **Phone testing.** The 44px targets, draft restore, timer controls and offline submit are built to spec but untested on a real phone with a dropped connection. The offline submit resolves the form as "queued" when the browser is offline or after 8 seconds; check it feels right in the stands.
- **Playwright e2e specs were not run** (they need `npx playwright install chromium webkit`). `e2e/form-analytics.e2e.ts` and its fixture seed BIOBUZZ-shaped values under the REBUILT form ids, so that spec will mismatch until it is updated or run with `EVENT_PROGRAM=ftc`.
- **Live APIs.** TBA, the FIRST FRC API and Statbotics were only exercised through mocked `fetch`. The FIRST FRC API's playoff match numbering was not confirmed to match decision D11, so playoff matches come from TBA only (no FIRST fallback).
- **The CS Firestore rules you supplied have no rules for several collections the app uses** (`scoutingFlagStates`, `teamAnnouncements`, legacy `judgeBookCards`/`versionReleases`). On production CS those collections fall through to "deny", so those features may already be failing silently there, or the live rules differ from what you pasted. The rebuild's `firestore.rules` adds them; check against the live rules before deploying anything.

## Security items in CS's own rules, deliberately left unchanged
Changing them could break live CS if both run on the same project, so they need your decision. They are marked `CS-OPEN` in `firestore.rules`.
- Any signed-in user can read and write 11 scouting collections across all teams.
- A user can write any field of their own user document, including `teamId`, `role` and `isTeamAdmin`, so they can skip join approval or promote themselves.
- Any signed-in user can create a team, and a team admin can write `verifiedOwnerId`.
- `accuracyRescouts` cannot be truly deleted (a rule quirk); the client soft-deletes instead. A member can take over another team's rescout doc by writing their own `teamId`.
- The CS owner uid is hardcoded in the rules (and configured through `RELEASE_OWNER_UIDS` / `NEXT_PUBLIC_RELEASE_OWNER_UIDS` for the app). If that env var is unset, nobody is treated as owner.

## Findings from the emulator tests that need an owner decision
- **Pick-list editors other than team admins cannot save.** CS's production rules let only team admins write `teams/{id}`, but the app (and CS's own permission list) also names lead-strategist, lead-scout, team-coach and drive-team as pick-list editors. `editPickList` by one of them is denied by the rules; a test asserts the denial. Fixing it means a field-scoped rule for `teams.pickList`, which changes CS's rules, so it was not done.
- **`teamAssignments` has no rule in CS**, so clients can neither read nor write it. As in CS, team-strategy assignments are written to the `matchAssignments` mirror, which works.
- Edits rewrite derived fields, matching CS's own behavior: a values edit rewrites `auto.estimatedFuel`, and a lead-scout edit rewrites `timestamp` along with `submittedAt`.
- `useFormEntries` reports `loaded` as soon as its first collection answers, so a list can briefly show partial data.

## Parity gaps (CS does it, the rebuild does not yet)
**Match Scout Form**
- Auto-selecting the next match on open: the rebuild shows a "Next assignment" banner with a Load button (and the `?load=next` link). CS's fallbacks when you have no assignment (first incomplete match, else next scheduled) are not ported.
- CS's `?editId&editCollection` deep link into the form (the rebuild edits through the admin entry editor).
- The finals bracket picker has no Scouted/Assigned marks (the practice and qualification lists do).
- "Scouted" checks use the team's own entries; CS read every team's rows for the event.
- Device notifications for new sub-in requests.
- Match-list scouted marks do not include lead, strategy-plan or drive-reflection completions.

**Other forms**
- Match Strategy prediction prefill (the hook point is documented in `lib/forms/builtin-rebuilt-forms.ts`), the lead form's auto-fill of robot team numbers from the chosen alliance, CS's pit-sync warnings on the strategy and drive forms, and digits-only filtering on number text fields.
- Drive reflection roles use CS's list (cycler, passer, shooter, stealer), which differs from match strategy's (Offense, Defense, Feeder), so role is not compared between a plan and its reflection.

**Practice and library**
- `/practice-scouting` does not read the `rescoutId`, `matchKey`, `teamNumber`, `alliance` and event parameters that the Accuracy Verification "Re-scout" button navigates with.
- Practice sessions written by the rebuild do not carry CS's embedded `scoutedData`/`allScoutedData`/`scoringWeights` (the values live in the linked `scouting` rows), so CS pages that read the embedded data will not see them.
- CS's live-lobby documents (stored inside `practiceSessions`) are skipped; the rebuild keeps its own `lobbies`/`liveMatches`.
- Admin library tables show only the rebuild's own `libraryMatches`; CS's imported `practiceMatches` appear read-only in the scout-facing lists.

**Analytics and events**
- Event details has no "Event Type" or "Week" (the API types carry neither). Its Schedule and Rankings tabs go beyond CS, which showed a "coming soon" card there.
- The Climb Reliability box plot needs `endgame.attemptedClimb`, which no CS form ever wrote, so it always says no attempts (same as CS).
- Match prediction, radar and compare skip entries of REEFSCAPE and CHARGED_UP with a message, because those games are read-only plugins that cannot rebuild a CS document.
- Thresholds that belong in `config/games` are still constants in `lib/analytics/` (`TOWER_POWER`, `HIGH_ACCURACY_MIN`, `RESCOUT_COMPARE_MIN_ACCURACY`, `CRITICAL_DIFF_PERCENT`, `LEAD_ROWS_SHOWN`, `SECTION_PREVIEW`).

**Admin, release notes, account**
- The two admin ID tools are Admin Panel tabs, but the old URLs redirect to plain `/admin` because the panel's tabs are local state (no `?tab=`).
- Release notes: CS's `versionReleases` notes (title and free-text body, editable by team admins, a `canManageVersionReleases` flag or the owner allowlist) do not appear in CE's changelog. That needs a one-time import or a read adapter.
- CS `form-builder` presets (the `formPresets` collection, REEFSCAPE-only) are not read; CE's builder in the Admin Panel replaces it.
- No "delete my account" button yet; the server route (`POST /api/user/delete`) and client helper (`deleteMyAccountData` in `lib/join-requests-client.ts`) exist but are not wired into the account page.
- Not audited: CS's cookie-consent banner and profile-picture upload on the account page.

## Data caveats
- Older or imported CS rows can lack `teamId`. Team-wide reads add a fallback (by member `scoutId`/`scoutName`), but event-scoped reads do not, so those rows are invisible there.
- Docs with no `eventKey` (all legacy helper reports, some old entries) read as event `""` and vanish from event-filtered views. CS inferred the event from timestamps; the rebuild does not.
- A CS match id `f1` is ambiguous (finals game 1, or bracket slot 1 from CS's bracket picker). The adapter reads `f1`..`f3` as finals games (14 to 16).
- CS keeps one manual flag per entry and one `dismissed` boolean; CE can hold several. The last manual flag is written to CS and the rest travel in additive `ceManualReason`/`ceManualNote` fields.
- A manually flagged CS entry is treated as excluded from stats by CS, but the rebuild's `excluded` means `excludeFromStats` only, so some stats can differ.
- The pick list is one list per team (as in CS), not per event.
- Additive fields the rebuild writes onto CS documents (harmless to CS): `isOwner`, `isPlatformOwner`, theme fields, `ceManualReason`, `stickyNotes`, `alliance` on plan and reflection docs, `eventKey` on helper docs, a `subInRequests` collection, and `selectedEventNames` on the team doc (`{ [eventKey]: name }`, written by Event Select beside `selectedEvents` with a merge write so event names survive a data-API outage; read in `data/cs/teams.ts`, the "stored" step of the name chain in `lib/events/names.ts`). Drop them if the schema freeze must be absolute.

## Cleanup left
- Multi-team accounts (CE's "field teams" and the team switcher) are removed: one team per team document, read through `lib/our-team.ts`. User and team docs that already carry `fieldTeams`, `fieldTeamIdList`, `fieldTeamNumbers`, `fieldTeamIds` or `activeFieldTeamId` are left untouched (never read, never deleted). The git tag `pre-ce-removal` keeps the old code for a later merge with sister teams, which would plug in at `lib/our-team.ts`.
- `lib/templates/official.ts` still builds its official form templates from BIOBUZZ constants (changing it renames seeded ids that several tests and the templates e2e assert).
- FTC mode: the BIOBUZZ pit and team forms and summaries are kept and selected by season, but FTC analytics for non-match forms and the templates have not been re-verified end to end.
- Mixed LF and CRLF line endings across files (git warns on commit). Normalise with a `.gitattributes` when convenient.
- `npm audit`, dependency upgrades and the two React Compiler lint warnings in `components/analytics/*-table.tsx` (TanStack Virtual) are inherited from CE.

## Where the old CS-only features went
| CS feature | Status |
|---|---|
| Event details | Built (`/events/[eventKey]`) |
| Judge Book | Built (`/judge-book`) |
| Match Prediction, Performance & Reliability, Robot Radar, Accuracy Compare, Accuracy Verification | Built |
| Sub-in requests | Built (own collection, D7) |
| Team announcements | Built (Team Management and a team-coach widget) |
| Admin ID tools | Built (Admin Panel tabs) |
| Privacy policy, terms of service | Built |
| Per-team TBA key page | Dropped: one server `TBA_API_KEY` (D4) |
| Verify-email page | Replaced by CE's banner |
| Disabled REEFSCAPE/CHARGED_UP submit forms, placeholder pages, dead duplicates | Not ported (read-only forms keep the old data visible) |

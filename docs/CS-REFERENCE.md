# CompSocrates reference

What the production CompSocrates app (CS) does and how it stores its data, written down so the rebuild can stay compatible with it and so nobody has to re-read CS's code to find out. CS is the source of truth for the data shape and the scoring; its architecture is not.

How the facts were gathered: a static read of the CS code base (nothing was run), then checked against the rebuild's own code where it implements the same thing (`config/games/*`, `data/cs/*`, `config/legacy-redirects.ts`). Counts such as "about 165 reads" are from that read and are approximate. The Firestore rules CS runs in production are saved in `docs/cs-firestore.rules` (reference only; the rebuild's own rules are in `firestore.rules`). Security findings about those rules and about CS's server routes are not repeated here: see `docs/SECURITY-NOTES.md`.

CS stack, for contrast with the rebuild: Next 16.1, React 19.2, Firebase 12.8, Tailwind 3.4, recharts, no tests, no shared page shell, no state or data library.

## 1. Route inventory and what became of each

CS has 71 `page.tsx` files. Every one is listed in `config/legacy-redirects.ts` as redirected, kept at the same URL, handled by a page redirect, or unreachable. `config/legacy-redirects.test.ts` fails if a CS route has no entry, if a destination is itself redirected, or if a destination page does not exist. Redirects are permanent (308). Decisions behind the map are in `docs/ROUTES.md`.

| CS route | Rebuild route | Notes |
|---|---|---|
| `/`, `/login`, `/signup`, `/privacy-policy`, `/terms-of-service` | same | Signup creates a team (the join code becomes the team doc id) or files a join request that a team admin approves. |
| `/verify-email` | `/dashboard` | The rebuild shows a verify banner instead of a page. |
| `/dashboard` | `/dashboard` | CS used it only for no-team onboarding. The rebuild's dashboard is role-keyed. |
| `/match-scout-dashboard`, `/scout-dashboard` | `/dashboard?role=match-scout` | The nine CS role dashboards share one page. |
| `/pit-scout-dashboard`, `/pit-team-dashboard`, `/drive-team-dashboard`, `/lead-scout-dashboard`, `/lead-strategist-dashboard`, `/media-dashboard`, `/judge-awards-dashboard` | `/dashboard?role=<role>` | Role ids: `pit-scout`, `pit-team`, `drive-team`, `lead-scout`, `lead-strategist`, `media`, `judge-awards`. |
| `/coach-dashboard`, `/team-coach-dashboard` | `/dashboard?role=team-coach` | |
| `/dashboard-selector` | `/dashboard` | The role switcher replaces the jump list. |
| `/event-selection`, `/event-details` | `/event` | |
| `/event-details/[eventKey]` | `/events/[eventKey]` | Plural, so an open event page is not caught by the restricted `/event` page. |
| `/match-list` | same | |
| `/scout-form` | `/scout` | `?lead=1` goes to `/lead-scout-form`. |
| `/scout-form-reefscape`, `/scout-form-placeholder` | `/scout` | The old REEFSCAPE submit was disabled and the placeholder had no links. All three games are now scouted through `/scout`. |
| `/pit-scout-form`, `/pit-scout-form-reefscape`, `/pit-scout-form-placeholder` | `/pit-scout-form` | |
| `/strategy-scout-form` | `/team-strategy-form` | |
| `/match-strategy-form`, `/helper-form` | same | |
| `/drive-scout-form` | `/drive-reflection-form` | |
| `/form-builder` | `/admin` | The Admin Panel's forms tab replaces it. CS's builder presets (`formPresets`) are not read. |
| `/practice-scouting`, `/scout-accuracy`, `/assignments`, `/team-management`, `/people`, `/account`, `/admin` | same | |
| `/admin/match-scout-ids`, `/admin/practice-session-ids` | `/admin` | The two ID tools are Admin Panel tabs. |
| `/analytics` | `/analytics/match-scout` | Redirected by the page itself. |
| `/analytics/lead`, `/analytics/pit` | `/analytics/lead-scout`, `/analytics/pit-scout` | |
| `/analytics/team-strategy`, `match-strategy`, `drive-reflection`, `helper`, `team-averages`, `match-breakdown`, `rankings`, `scout-status`, `team-breakdown` | same | |
| `/analytics/team-breakdown/[teamNumber]` | `/analytics/teams/[teamNumber]` | |
| `/pick-list`, `/analytics/pick-list` | `/analytics/pick-list` | |
| `/analytics/match-prediction`, `performance-reliability`, `robot-radar`, `accuracy-compare`, `accuracy-verification` | same | CS-only analytics, all rebuilt. |
| `/profile/[userId]` | `/people/[userId]` | |
| `/profile-[userId]` | none | The folder name was not a dynamic segment, so the URL never worked. No redirect. |
| `/settings/api-keys` | `/team-settings` | The page held a per-team TBA key. The rebuild uses one server key and has no such section. |
| `/judge-book`, `/judge-book/[cardId]` | same | |
| `/version-releases`, `/changelog`, `/update-lot` | `/changelog` | |

CS-only features and their fate:

| Feature | Fate |
|---|---|
| Event details (`/event-details`) | Rebuilt as `/events/[eventKey]`, with extra Schedule and Rankings tabs where CS showed a "coming soon" card. |
| Judge Book | Rebuilt. Cards live on the team doc, with a read fallback to the legacy `judgeBookCards` collection. |
| Match Prediction, Performance and Reliability, Robot Radar, Accuracy Compare, Accuracy Verification | Rebuilt. |
| Sub-in requests (rows inside `scouting`, polled every 20 s) | Rebuilt on their own `subInRequests` collection with a realtime listener and a transactional claim (D7). Legacy rows are still read and filtered out of `scouting`. |
| Team announcements (`teamAnnouncements`) | Rebuilt (Team Management and a team-coach widget). |
| Admin ID tools | Rebuilt as Admin Panel tabs. |
| Per-team TBA key page | Dropped: one server `NEXT_PUBLIC_TBA_API_KEY`. |
| `/form-builder` | Replaced by the Admin Panel forms tab (it was never wired to the live REBUILT forms; presets applied to REEFSCAPE only). |
| Disabled REEFSCAPE and CHARGED UP submit paths | Replaced: every game is a config entry and submittable. |
| Dead code: `scout-form-placeholder`, `pit-scout-form-placeholder`, `profile-[userId]`, the dead `sub-in-requests` API, the disabled CSV import and export buttons, and the unused `RoleDashboard`, `TeamRequests`, `TeamRequestsPanel`, `TBAKeySettings`, `FinalsMarchSelector`, `utils/tbaHelpers.ts`, `utils/accuracyStatus.tsx`, `hooks/useScoutAccuracy.ts` | Not ported. |

## 2. Data model

### 2.1 Conventions

- **Timestamps** (`createdAt`, `submittedAt`, `timestamp`) are epoch-millisecond numbers, never Firestore `Timestamp`s.
- **Identity:** `scoutId` (uid), `scoutName` (display name), `teamId` (the team code). Several CS queries join on `scoutName`; the rebuild joins on `scoutId` and keeps a name fallback for old rows.
- **Context fields:** `eventKey` (a TBA key such as `2026arli`) and `game`. A doc with no `game` field is REEFSCAPE.
- **Team doc id** is the uppercase join code; other docs' `teamId` points at it.
- **Team number** is a string on team docs and entries, and a number on assignment docs.
- **Isolation:** most CS analytics pages read whole collections with no `teamId` filter. The rebuild scopes reads to the signed-in team.
- **Edit mode:** CS's `?editId&editCollection` URL parameters were used directly as the collection name in `setDoc`. The rebuild edits through the Admin entry editor and never takes a collection name from the URL.
- **Rules:** CS keeps no `firestore.rules` in its repo. Client fallbacks hint at drift between code and rules: six payload shapes for join requests, `leadScouting` falling back to `scouting`, assignment writes that swallow permission errors.

### 2.2 Collections

**`users/{uid}`**
- Fields: `uid, email, displayName`; `role` (single), `roles[]`, `secondaryRoles[]`, `specialRole(s)`; `teamId, isTeamAdmin`; `photoURL, bio, profileVisibility` (`team | public | private`), `profileComplete`; `preferredDashboard` (a route path); `canManageVersionReleases, emailVerificationExempt`; `accountThemeId, accountFontId, experiencedScout, createdAt`; `encryptedUserData, userDataEncryptedAt` (a write-only copy CS sent through an encrypt route and never read back).
- Valid roles: `match-scout, pit-scout, pit-team, drive-team, lead-scout, lead-strategist, team-coach, media, judge-awards`. Legacy values (`scout`, `coach`, `lead_scout`, and others) are normalized.
- An account is an admin when `isTeamAdmin` is true or the legacy `role` is `coach` (`isAdminFromCsUser` in `data/cs/users.ts`, decision D6).
- Queries: `where teamId ==`, `where email ==`.

**`teams/{TEAMCODE}`**
- Identity and events: `teamName`, `teamNumber` (string), `verifiedOwnerId`; `selectedEvents: string[]` (TBA keys); `eventAttendees: {eventKey: (uid|name)[]}`; `tbaApiKey` / `tbaApiKeyEncrypted`.
- Controls: `formAccessOverrides: {formKey: uid[]}`; `timeOverride {enabled, offsetMs, updatedAt, updatedBy}`; `submissionControls {globalLockout, lockoutReason, updatedAt, updatedBy}`; `metricVisibilityRules[]`, `publicMetricAnonymization`.
- Assignment helpers: `manualTeamListsByEvent`, `priorityTeams*` (several aliases), `scoutCount`, `eventScoutCounts`.
- Pick list and forms: `pickList`, `activePitFormPresetId`, `activePitGame`, `activeMatchFormPresetId`, `activeMatchGame`.
- Legacy embedded data: `judgeBookCards[]`, `judgeBookUpdatedAt`, release notes.
- Quirk: a hot catch-all document. CS read it about 49 times across 39 files.

**`scouting`** (auto id): the largest collection, and it holds several kinds of row. Every analytics query must exclude the non-official kinds (`entryMatchesAnalyticsFilters` in CS; `CsRowKind` in `data/cs/types.ts` in the rebuild).
- Row kinds: official entries; practice rows (`isPracticeScouting`, `practiceMode`, `practiceSessionId`, `difficulty`, `accuracy`, `device*`); sub-in requests and claims (`entryType: "sub-in-request" | "sub-in-claim"`, `requestedAt`, `requestedById/Name`); lead-scout rows written through a permission fallback (`entryType: "lead"`); legacy REEFSCAPE rows.
- Official REBUILT payload:
  - Identity: `scoutName, scoutId, teamId, eventKey, game: "REBUILT", matchId` (`p3 | q12 | qf2 | sf5 | f1`), `matchType` (`practice | qualification | finals`), `matchNumber` (string), `teamNumber` (string), `startingPosition`.
  - `auto { preloadScale, bpsScale, carryingScale, cycleTimes[], estimatedFuel, counterOverride, counterOverrideMissedFuel, humanPlayerFuel, failedClimb, successfulClimb, wonAuto, hubActivationOverride }`
  - `teleop { shiftParityFromWonAuto, bpsScale, carryingScale, transitionCycles, shift1Cycles..shift4Cycles, transitionOverride, transitionMissedFuel, shiftNOverride, shiftNMissedFuel (N = 1..4), humanPlayerFuel, estimatedFuel }`
  - `endgame { cycleTimes, counterOverride, counterOverrideMissedFuel, humanPlayerFuel, estimatedFuel, failedClimb, status }`
  - `incidents[], notes, scoringWeights, submittedAt, timestamp`.
- Practice rows add `matchKey, eventName, alliance/allianceColor, accuracy, penaltyPoints`. Analytics adds `accuracy`, `accuracyDetails`, `excludeFromStats`.
- Quirks: there is no `source` field, so practice versus official is inferred from flags or label sniffing (`normalizeMatchLabel` has dozens of typo-tolerant patterns). No total score is stored: analytics recomputes it from the raw fields.
- Queries: `where eventKey ==`, `where scoutId ==`, `where scoutName ==`, `where teamId == and entryType ==`, plus whole-collection reads.

**`pitScouting`**
- Fields: `teamNumber, robotWeight, rookieTeam, robotPictureUrl` (URL text, not Storage); `pitDisposition, driveDisposition`; `fuelPreloadCapacity, fuelBallsPerSecond, fuelCarryingCapacity` (strings, often ranges such as "10-13"); `climbLevel1..3, typicalFuelCycleTime, typicalClimbTime, autoCycleDescription, notes`; `scoutName, game: "REBUILT", eventKey, teamId, submittedBy, createdAt, submittedAt`.
- Coupling: the match form reads these (`parsePitValue`) to prefill the scales and warn on a mismatch. CS tries `teamId + teamNumber + game` first, then falls back to all REBUILT pit docs from any team.

**Other form collections**
- `strategyScouting`: `teamNumber, preferredStartingPosition, bestAt, clearsBump, clearsTrench, canShootWhileIntaking, canMoveAndShootSimultaneously, notes`.
- `matchStrategyPlans` and `driveScouting`: `matchKey, matchLabel, robots[3]{teamNumber, startingPosition, role, autoClimb, endgameClimb, climbProbability?, estimatedPoints?, predictionSampleSize?}, notes`.
- `helperReports`: `helperName, helperId, assistedTeamNumber, wasSuccessful, issueSolved, notes`. No `eventKey`.
- `leadScouting`: `alliance, robots[3]{teamNumber, notes, skillLevel 1-5}, overallAlliance{teams, notes, skillLevel}, isLeadScouting, entryType: "lead", matchKey/matchId/matchLabel/matchType/matchNumber, isPracticeScouting`.

**Assignments, practice and live**
- `matchAssignments`: one doc per scout and match: `teamId, eventKey, matchKey, matchLabel, scoutId, scoutName, teamNumber` (number), `scoutHumanPlayer, assignedBy, assignedAt`. Team-strategy assignments reuse it with `assignmentType: "team", matchKey: "team"`.
- `pitAssignments`, `teamAssignments`: the same shape without match fields. `practiceAssignments` adds `practiceMatchId, matchKey "pN"`.
- `practiceMatches` (seeded by scripts, one doc per alliance per match, only matches with a YouTube video): `matchKey, eventKey, eventName, matchNumber, matchType, compLevel, setNumber, videoUrl, difficulty, alliance, allianceTeams` (up to 3 numbers), `actualScore, officialScore, penaltyPoints, officialData {score, penaltyPoints, breakdown}, game, createdAt, importedByScript`.
- `practiceSessions`: `teamId, scoutName, scoutId, matchId/Key/Number/Type, alliance, difficulty, mode` (`trial | competitive`), `isLivePracticeScouting, liveVideoUrl, scoutedData, allScoutedData[], eventKey, eventName, game, officialScore, actualScore, scoutedScore, penaltyPoints, accuracy, scoringWeights, device*`, timestamps. CS overloads the collection as its live-lobby store (`code, hostId, status, playersByUid, matchJson, assignmentsJson, submissionsJson`).

**Governance and social**
- `teamJoinRequests`: `userId, userEmail, userEmailLower, userName, userRole, requestedRole, teamId, status` (`pending | approved | denied | canceled`), `createdAt, processedAt, processedBy, canceledByUser, profileSyncPending, profileSyncedAt, teamDisplayLabel`.
- `accuracyRescouts`: `teamId, eventKey/Name, matchKey/Label, game, alliance, teamNumber, scoutId/Name, status, accuracy, criticalFlag, createdAt, updatedAt, originalScouts[]`.
- `scoutingFlagStates`: doc id `"{entityType}:{entityId}"`, with `teamId, entityType, entityId, dismissed, manualFlagged, manualReason, excludeFromAccuracy, excludeReason, *At/*By`. Entity types: scoutingEntry, practiceSession, leadScouting, pitScouting, strategyScouting, matchStrategyPlan, driveScouting, helperReport.
- `formPresets`: `teamId, name, formType` (`match | pit`), `game`, `fields[]{id, label, type, section, options, scaleLabels, required}, updatedAt`. Applied to REEFSCAPE forms only.
- Small collections: `teamAnnouncements` (`teamId, authorId/Name, body, type, createdAt`), `judgeBookCards` and `versionReleases` (both with primary storage embedded in the team doc and a legacy collection fallback), and `subInRequests` (written only by a dead CS API; CS sub-ins really lived in `scouting`).

### 2.3 Events and matches

- Selected events: per team, in `teams/{id}.selectedEvents`. A user's current event is auto-detected from dates (the active event, else the next, else the latest), falling back to `"app-testing"`. A team `timeOverride` offsets "now" for testing.
- Schedules are never stored: CS fetched them live from TBA (FIRST for practice) on every form and dashboard load.
- Event aliases: old keys map to current ones (`2025lake` and `2026labr` to `2026lake`), and CS ran one query per alias. The rebuild keeps the table in `config/event.ts`.
- Hardcoded events in CS: `utils/events.ts`, `utils/analyticsEvents.ts`, `utils/eventDates.ts`, about 18 files that name the fallback sentinel. The rebuild keeps the real names CS states in `config/event-names.ts`.
- The match-id mapping that handles the 2026 double-elimination encoding is `utils/reefscapeMatchSync.ts` despite its name; it is the real mapper for all games. The rebuild's version is `data/cs/match-id.ts`.
- Integrations: TBA (`api/tba/*`, a per-team encrypted key), the FIRST FRC API (`api/first/*`), Statbotics (`api/statbotics/team`), YouTube oEmbed (`api/live-stream/title`).
- Browser storage keys: `analytics-selected-game`, `analytics-selected-event`, `analytics-practice-matches-only`, practice drafts (per uid), `practice-live-lobbies`, theme caches, `cs-notification-prompted`, cookie consent.

## 3. The games

Each game is one entry in `config/games/` (`rebuilt.ts`, `reefscape.ts`, `charged-up.ts`; shared tolerances and thresholds in `shared.ts`). REEFSCAPE and CHARGED UP are pure point tables whose plugin (`lib/games/point-table.ts`) and form (`lib/forms/game-form.ts`) are generated from the entry; REBUILT keeps a hand-written plugin (`lib/games/rebuilt.ts`) because its fuel scoring has cross-field logic. All three are submittable. CS only allowed REBUILT to be submitted. Scoring is golden-tested against verbatim copies of CS's own functions in `lib/games/cs-oracle/`.

Form value keys follow one convention shared by the adapter: a CS field at `phase.field` is the value key `phase_field`; a top-level field keeps its name.

### 3.1 REBUILT (2026)

Source in CS: `app/scout-form/page.tsx` (3,007 lines) and `app/utils/analyticsScoring.ts`.

**Fields**
- Identity: scout name (read-only), team number picker, match picker, `startingPosition` (not-there, outpost-trench, outpost-side, outpost-bump, middle, depot-bump, depot-side, depot-trench).
- Auto: preload, BPS and carry scales; cycle timers; scored-override and missed-fuel counters; human-player fuel; failed climb (a count); successful climb, won auto and hub activation override (checkboxes).
- Teleop: BPS and carry scales; transition and shift 1 to 4 cycle timers (each with scored-override and missed-fuel); human-player fuel.
- Endgame: cycle timers, scored-override and missed-fuel, human-player fuel, failed climb, status (`""`, `parked`, `level-1`, `level-2`, `level-3`).
- Incidents: died, never-started, disabled, recovered, tipped, yellow-card, red-card. Plus free-text notes.
- Validation: the only hard requirements are a selected match and a non-empty team number. Two confirm prompts (team already scouted, pit-scale mismatch) and a submission-lockout check.

**Scoring**
- Scales (a doc stores the index):
  - BPS `[0, 2, 5, 8, 12, 16, 20, 23, 25]`
  - Carry `[0, 12, 23, 32, 42, 53, 64, 74, 75]`
  - Preload `[0, 2, 4, 6, 8]`
- Cycle estimate: `round(min(capacity, BPS * seconds))`. The first auto cycle uses the preload capacity when it is above 0.
- Section fuel: the scored override if above 0, otherwise `max(0, estimate - missed)`.
- Totals:
  - `autoFuel = autoSection + autoHumanPlayer`
  - `teleFuel = transition + (parity ? shift2 + shift4 : shift1 + shift3) + teleopHumanPlayer`
  - `endgameFuel = endgameSection + endgameHumanPlayer`
  - Stored parity is `wonAuto XOR hubActivationOverride`. If it is absent, `auto.wonAuto` is used.
- Climb points: auto 15; endgame 10, 20 or 30 for levels 1 to 3. `parked` and any other status score 0.
- Total score: all fuel (1 point each) plus climb points. Failed climb, start position, incidents and penalties are not scored.
- Weights snapshot CS writes on every doc: `{autoFuel: 1, autoClimbLevel1: 15, teleopFuel: 1, teleopClimbLevel1: 10, teleopClimbLevel2: 20, teleopClimbLevel3: 30}`.
- Not stored: the total. Analytics recomputes it from raw fields. Some CS pages read the stored `estimatedFuel` instead of recomputing from cycles, so they could disagree.

**Other REBUILT logic**
- Accuracy: `1 - |scouted - official| / official`, clamped to 0..1, per alliance, against the official TBA scores.
- Verification (lead against junior): auto fuel within 2, teleop fuel within 4, endgame fuel within 2, auto climb exact, endgame status exact. 85% or more matched is Verified.
- Flags: high human-player share (at least 15 human fuel and either no robot fuel or at least 60% of robot fuel), auto-only (at least 20 auto fuel and no teleop fuel), zero main scoring.
- Prediction: source filter official, practice or combined; estimate `round((avg + percentile) / (n > 1 ? 2 : 1))` with confidence tiers 75, 85 and 90 (default 85); role Offense when the estimate is at least 25, Feeder when at least half the rows have a climb success, otherwise Defense.
- Rescout comparison: field-by-field diff against an exemplar (arrays compared by average, weight 0.25).
- Practice difficulty: an alliance score up to 200 is easy, up to 400 medium, above that hard.

**CS bugs not carried over**
- Every per-shift "Human Player" counter in teleop shared one state variable (`teleopHumanPlayerFuel`), so the per-shift UI was cosmetic. The rebuild has one counter per segment (D8): it writes `teleop.humanPlayerFuelByShift` and sets `teleop.humanPlayerFuel` to the sum of the counted segments (transition always, shifts by parity), so CS readers and an old doc that holds a single total score the same.
- `submit()` computed the estimates twice.
- The REBUILT scoring was copy-pasted into about 5 files despite the shared `analyticsScoring.ts`. There is one plugin now.

### 3.2 REEFSCAPE (2025)

Flat fields, no nested phases. A CS doc with no `game` field is REEFSCAPE.
- Leave 3.
- Auto coral L1 to L4: 3, 4, 6, 7. Auto processor 6, auto net 4.
- Teleop coral L1 to L4: 2, 3, 4, 5. Teleop processor 6, net (robot) 4, net (human) 4.
- Cage status is matched by "includes", first rule wins: `deep` 12, `shallow` 6, `park` or `barge` 2. CS quirk kept on purpose: the form's own "not-parked" option contains "park", so it scores 2.
- The alliance's official penalty points are added to the total.
- Flags (in points): human net points at least 20 and at least 60% of robot teleop points; auto points at least 20 with no teleop points; zero main scoring.
- Starting positions are the same eight as REBUILT.

### 3.3 CHARGED UP (2023)

Nested `auto`, `teleop` and `endgame`; `startingPosition`, `mobility`, `penaltyPoints`, `incidents` and `notes` are top-level.
- Mobility 3. CS scores `auto.mobility ?? mobility` and its practice flow writes both, so the rebuild writes both and reads either.
- Auto grid rows (bottom, middle, top) 3, 4, 6; auto charge station docked 8, engaged 12.
- Teleop grid rows 2, 3, 5; links 5.
- Endgame charge station parked 2, docked 6, engaged 10 (lower-case values, exact match).
- Official penalty points are added to the total. Starting positions: Barrier Side, Middle, Corner Side.
- CS raises no CHARGED UP flags and has no rescout comparison for it; the rebuild's rescout field list is a sensible equivalent. Practice difficulty cut-offs are 80 and 120.

## 4. Data compatibility notes

The rebuild keeps CS's collections and field shapes (D1) and reads and writes them through `data/cs/*`, so the CS app and the rebuild can share one Firestore project. What the adapter does so that history stays correct:

- Reads each `scouting` row by kind and skips sub-in, lead and practice rows when building match entries.
- Parses string numbers, converts epoch-ms timestamps, and folds `qf` / `sf` / `f` ids into one playoff convention: bracket matches 1 to 13, finals `f1` to `f3` as 14 to 16 (D11). A CS id `f1` is ambiguous (finals game 1, or bracket slot 1 from CS's bracket picker); it reads as finals.
- Computes every score with the game plugins at read time, so historical totals match what CS shows, and merges `scoutingFlagStates`.
- Treats a missing `game` as REEFSCAPE, a legacy event alias as its current key, and a missing `eventKey` as event `""` (CS inferred the event from timestamps; the rebuild does not, so such rows vanish from event-filtered views).
- Older or imported rows can lack `teamId`. Team-wide reads add a fallback by member `scoutId` and `scoutName`; event-scoped reads do not.
- Writers use merge writes and never drop a field they do not understand (D10), for example `encryptedUserData` and `priorityTeams*`. Writes publish a minimal diff.
- CS keeps one manual flag per entry and one `dismissed` boolean; the rebuild can hold several manual flags. The last one is written in CS's shape and the rest travel in additive fields.
- The pick list is one list per team (as in CS), not per event.
- Anything the rebuild adds is additive and listed in `docs/REMAINING.md`.

## 5. CS performance and structure problems deliberately not inherited

- **Read volume:** about 167 `getDocs` calls, 3 `onSnapshot` listeners and 49 team-doc reads across 39 files. About 10 pages read the whole `scouting` collection. `calculateTeamStats` read six full collections. The rebuild subscribes once per source through shared providers and scopes reads to the team.
- **Waterfalls:** the role dashboard loaded stats, events, practice sessions, assignments, sub-ins, the team doc and TBA matches one after another; the scout form made about seven sequential awaits; analytics did an N+1 `getDoc` over practice sessions.
- **Keys:** joins on `scoutName` instead of `scoutId`. A 20 s polling loop per open dashboard for sub-ins (now a listener).
- **Event resolution:** 14 files resolved the event independently and 18 called the TBA match endpoint. The rebuild resolves events in one provider and names them through one chain (D14).
- **No shared shell:** 35 pages imported `Sidebar` and wrapped themselves in `ProtectedRoute`. Every signed-in page now sits under `app/(app)/layout.tsx`.
- **Giant files:** `practice-scouting` 288 KB, `assignments` 211 KB, `analytics/page` 155 KB, `scout-form` 145 KB, `scout-accuracy` 112 KB, and seven more over 40 KB. Duplicated `CycleTimer`, `ClimbCounter` and `TeamPickerModal` (three pages each).
- **Dead code:** about 200 KB of root `__hist_*` and `__orig_*` files and empty `Cycles` and `Delete` files (type-checked because of the tsconfig include), 21 one-off scripts inside `app/`, and the unused modules listed in section 1.
- **Dependencies:** `dotenv` as a runtime dependency used only by scripts; `recharts` used by two files; `tailwind.config.js` scanning a nonexistent `./components/**`.
- **UI quality:** about 325 `alert()` and 40 `confirm()` calls; about 600 hardcoded Tailwind colors and 124 inline hex values against about 414 `var(--*)` uses, so dark themes did not fully apply; about 26 ARIA attributes in the whole app; color-only status chips.
- **Scout form:** no draft or autosave; after submit an `alert()` and `window.location.reload()`; 32 px counter buttons and tiny delete-cycle buttons; `h-screen`; no `inputMode` on the team-number field.
- **Correctness:** `new Date().getFullYear()` for event lists (breaks across a year boundary); the shared per-shift human-player state; a hooks-after-return bug in `scout-form-placeholder`.
- **Missing infrastructure:** no tests, no Firestore rules in the repo, no PWA manifest, no offline support.
- **Security and privacy:** see `docs/SECURITY-NOTES.md` (local only).

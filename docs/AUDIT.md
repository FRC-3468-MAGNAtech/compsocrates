# Phase 0 Audit: CompSocrates rebuild on CompEpicurus

Status: Phase 0 complete, awaiting approval. No code has been written, and CE and CS were not modified.
Method: static reading of both code bases (no `node_modules`, nothing was run or built). Claims marked *(unverified)* need a runtime check in a later phase.

Abbreviations: **CE** = CompEpicurus (`CompEpicurus (reference)\`), **CS** = CompSocrates (`CompSocrates (reference)\`). Paths are relative to each project root.

## 0. Headline findings

1. **CE is an FTC app, not an FRC app.**
   - It uses the FTC Events API, 2-team alliances (`red1, red2, blue1, blue2`), `eventCode` plus a numeric season, and the 2026 FTC game BIOBUZZ.
   - CS is FRC: TBA, the FIRST FRC API, Statbotics, 3-team alliances, and the 2026 game REBUILT.
   - "CE pointed at CS's event" means replacing CE's event layer (`lib/ftc`, `lib/accuracy`, `lib/epa`, `lib/scheduler`, `lib/team-assignments`, `lib/live`, `lib/lobby`, the library flow), not swapping config.
2. **CE cannot read CS's data as-is.** Collections, field names, types and the user/team doc shapes all differ (section 3.3).
3. **CE already has the config-driven seam that CS lacks.** A CE `Form` object drives the scout form, scoring, analytics columns, CSV and flags. About 60% of CS's REBUILT form maps onto it today (section 2.3).
4. **Neither app has an in-progress entry draft.** CS has no offline support at all. CE queues writes through Firestore persistence, but its submit may hang while offline *(unverified)*.
5. **CS has security and privacy problems to avoid inheriting** (section 6.1): whole-collection cross-team reads, browser-exposed API keys, unauthenticated encrypt routes, a shared "migration user" credential, and a URL-supplied collection name used in writes.

## 1. Page matrix

Legend: **Both** = exists in both apps; **CS only**; **CE only**. "Diff" says how much behavior differs beyond event-specific data. Status: REAL, WRAPPER (thin wrapper over a shared component), ALIAS/REDIRECT, DEAD, PLACEHOLDER, LEGACY (submit disabled).

### 1.1 In both

| Area | CS route | CE route | Diff beyond event data |
|---|---|---|---|
| Landing | `/` | `/` (marketing) | Low |
| Login | `/login` | `/login` | Low. CE adds Turnstile. |
| Signup | `/signup` | `/signup`, `/finish-setup`, `/apply` | **High.** CS creates a team (join code becomes the team id) or sends a join request that an approver accepts. CE uses a join code plus team applications. |
| Dashboard | `/dashboard` (no-team onboarding only) and 9 role routes (`/match-scout-dashboard`, `/pit-scout-dashboard`, `/pit-team-dashboard`, `/drive-team-dashboard`, `/lead-scout-dashboard`, `/lead-strategist-dashboard`, `/media-dashboard`, `/judge-awards-dashboard`, `/coach-dashboard`) | `/dashboard` | **High.** CE is one page with a role-keyed widget registry and an admin "view as" switcher. CS uses separate routes sharing `components/TeamRoleDashboard.tsx` (57KB) and sub-in request UI. |
| Event select | `/event-selection` | `/event` | **High.** CE is admin-only, drag-sort, primary event, status filters, up to 10 events. CS: any member, checkbox list, `alert()`, current calendar year only. |
| Match list | `/match-list` | `/match-list` | Medium |
| Match scout form | `/scout-form` (+ `?lead=1` lead mode) | `/scout` | **High** (sections 2.3, 3.4) |
| Pit scout form | `/pit-scout-form` | `/pit-scout-form` | Medium. CE form is schema-driven. |
| Lead scout form | `/scout-form?lead=1` | `/lead-scout-form` | Medium. CS writes `leadScouting`. CE writes `formEntries`. |
| Match strategy form | `/match-strategy-form` | `/match-strategy-form` | Medium. CS prefills from the prediction engine. |
| Team strategy form | `/strategy-scout-form` | `/team-strategy-form` | Medium |
| Drive reflection form | `/drive-scout-form` | `/drive-reflection-form` | Medium |
| Helper form | `/helper-form` | `/helper-form` | Low |
| Assignments | `/assignments` (211KB) | `/assignments` | **High.** Different data model (section 3.3), CS has an auto-assign algorithm and manual team lists. |
| Practice scouting | `/practice-scouting` (288KB) | `/practice-scouting` | **High.** CS seeds `practiceMatches` from scripts, 3 games, trial/competitive modes, local drafts, live lobbies stored in `practiceSessions`. CE has solo, live and lobby flows over `libraryMatches`/`lobbies`. |
| Scout accuracy | `/scout-accuracy` (112KB) | `/scout-accuracy` | Medium |
| People | `/people` | `/people`, `/people/[uid]` | Low |
| Profile | `/profile/[userId]` | `/profile` | Medium |
| Team management | `/team-management` | `/team-management` | Medium. CS has join requests and metric visibility rules. |
| Account | `/account` | `/account` | Medium. CE adds appearance and notifications. |
| Admin | `/admin`, `/admin/match-scout-ids`, `/admin/practice-session-ids` | `/admin` | **High.** CE is a tabbed panel (forms, page access, library, audit, backups, sessions, rescore, applications). |
| Analytics: match scout | `/analytics` (155KB) | `/analytics/match-scout` | **High** |
| Analytics: lead / pit / team strategy / match strategy / drive reflection / helper | `/analytics/lead`, `/pit`, `/team-strategy`, `/match-strategy`, `/drive-reflection`, `/helper` | `/analytics/lead-scout`, `/pit-scout`, `/team-strategy`, `/match-strategy`, `/drive-reflection`, `/helper` | Medium. CE uses one `FormAnalyticsPage` for all. |
| Analytics: team averages, match breakdown, rankings, team breakdown, pick list | same slugs | same slugs | Medium. CS pick list mixes FIRST rank, Statbotics EPA and scouted averages. CE uses in-house EPA. |
| Analytics: team detail | `/analytics/team-breakdown/[teamNumber]` | `/analytics/teams/[teamNumber]` | Medium |
| Analytics: scout status | `/analytics/scout-status` (83KB) | `/analytics/scout-status` | Medium |
| Changelog | `/version-releases` (+ aliases `/changelog`, `/update-lot`) | `/changelog` | Medium |

### 1.2 CS only

| CS route | Status | Notes |
|---|---|---|
| `/event-details`, `/event-details/[eventKey]` | REAL | Event list, teams, matches, FIRST data |
| `/coach-dashboard` | REAL | team-coach hub (63KB): stats, sub-in requests, announcements |
| `/dashboard-selector` | REAL | Admin jump list to the role dashboards |
| `/judge-book`, `/judge-book/[cardId]` | REAL | Cards stored on the team doc, with a legacy-collection fallback |
| `/settings/api-keys` | REAL | Per-team TBA key (team-coach) |
| `/analytics/match-prediction` | REAL | Prediction engine (75/85/90 confidence tiers) |
| `/analytics/performance-reliability` | REAL | Uses recharts |
| `/analytics/robot-radar` | REAL | Uses recharts |
| `/analytics/accuracy-compare`, `/analytics/accuracy-verification` | REAL | Lead-vs-junior verification, 85% threshold |
| `/verify-email`, `/privacy-policy`, `/terms-of-service` | REAL | CE has no equivalent routes (CE has an email-verify banner) |
| `/form-builder` | REAL, **not wired** | Team presets that apply to REEFSCAPE only. REBUILT presets are explicitly disabled. CE has a far more capable builder in `/admin`. |
| Team Communication hub (`TeamAnnouncements`) | REAL | Collection `teamAnnouncements` |
| `/scout-form-reefscape`, `/pit-scout-form-reefscape` | LEGACY | Submit disabled; reefscape form has demo teams hardcoded |
| `/scout-form-placeholder`, `/pit-scout-form-placeholder` | PLACEHOLDER/DEAD | No inbound links; the first violates the rules of hooks |
| `/profile-[userId]` | DEAD | Folder name is not a dynamic segment, so the route is unreachable |
| `/changelog`, `/update-lot`, `/team-coach-dashboard`, `/scout-dashboard`, `/pick-list` | ALIAS/REDIRECT | Re-export or redirect to another route |

### 1.3 CE only

| CE route | Status | Notes |
|---|---|---|
| `/apply`, `/finish-setup` | REAL | Team application flow, FTC-bound |
| `/my-scouting` | REAL | Own scouting stats |
| `/credits` | REAL | Credits board |
| `/team-settings` | REAL | FTC field teams, ownership transfer. **Not in the page-access registry.** |
| `/changelog` | REAL | CE's own changelog store |
| `/admin` sub-panels | REAL | Forms, page access, library, audit log, backups, sessions, rescore, applications, templates |
| `/e2e/*` (12 fixture pages) | TEST-ONLY | Shipped in the production build; `notFound()` unless `E2E_THEME_CHECK=1` |

## 2. Event-specific surface

### 2.1 CE

- **Game seam:** `lib/forms/builtin.ts` defines `BIOBUZZ_FORM` and is "the only place that names a game element". `BUILTIN_FORMS` also merges `builtin-team-forms.ts` and `builtin-pit-forms.ts`. `DEFAULT_FORM_ID` is `"biobuzz"`.
- **Seasons:** `lib/seasons.ts` has one entry (`biobuzz`, API season 2026).
- **Integrations:** FTC Events API v2.0 (`lib/ftc/*`), YouTube oEmbed (`lib/live/*`), FCM push, Vercel Blob, Resend, Turnstile. There is no TBA and no Statbotics.
- **FTC-bound logic:** alliance size 2 (`DEFAULT_ALLIANCE_SIZE`), slot labels, the accuracy engine (`lib/accuracy/engine.ts`), in-house EPA (`lib/epa`), the scheduler, assignments, live and lobby scoring.
- **BIOBUZZ residue outside the seam:** legacy 15-key dual-write in `lib/scout-entries.ts`; `canScoreHive`/`canScoreFlower` in `lib/analytics/form-summaries.ts`; BIOBUZZ fallbacks in `lib/admin/backup.ts`, `lib/forms/forms-context.tsx`, `lib/analytics/game-schema.ts` and `components/scout/scout-form.tsx`; a `biobuzz` color theme; `lib/forms/fixtures/biobuzz-v1*` (a frozen test oracle).
- **Imagery and team lists:** none. Teams come live from the FIRST API.

### 2.2 CS

- **Games baked in:** `CHARGED_UP` (2023), `REEFSCAPE` (2025), `REBUILT` (2026). A doc with no `game` field is REEFSCAPE. Only REBUILT can be submitted from the form UI today.
- **Hardcoded events:** `utils/events.ts` (2026arli, 2026lake), `utils/analyticsEvents.ts` (2025alhu, 2025lake, 2023mslr, 2023lake), `utils/eventDates.ts` (duplicate date constants), the aliases `2025lake`/`2026labr` to `2026lake`, and the `"app-testing"` fallback sentinel (about 18 files).
- **Event detection:** `utils/eventDetection.ts` picks the active, else next, else latest event from dates. A team `timeOverride` offsets "now" for testing.
- **Integrations:** TBA (`api/tba/*`, per-team encrypted key), FIRST FRC API (`api/first/*`), Statbotics (`api/statbotics/team`), YouTube oEmbed (`api/live-stream/title`).
- **Match-id mapping:** `utils/reefscapeMatchSync.ts` is the real mapper for all games despite its name (handles the 2026 double-elimination slot encoding).
- **Imagery:** none. The modals are generic. The finals bracket is inline SVG.
- **Team lists:** from TBA/FIRST or manual lists. `scout-form-reefscape` has demo teams 1234 to 7890.

### 2.3 REBUILT form: fields and scoring as implemented in CS

Source: `app/scout-form/page.tsx` (3,007 lines) and `app/utils/analyticsScoring.ts`.

**Fields**
- **Identity:** scout name (read-only), team number picker, match picker, `startingPosition`. The 8 positions are not-there, outpost-trench, outpost-side, outpost-bump, middle, depot-bump, depot-side, depot-trench.
- **Auto:** preload, BPS and carry scales; cycle timers; scored-override and missed-fuel counters; human-player fuel; failed climb (count); successful climb, won auto and hub activation override (checkboxes).
- **Teleop:** BPS and carry scales; transition and shift 1-4 cycle timers (each with scored-override and missed-fuel); human-player fuel.
- **Endgame:** cycle timers, scored-override and missed-fuel, human-player fuel, failed climb, status (`""`, `level-1`, `level-2`, `level-3`).
- **Incidents:** died, never-started, disabled, recovered, tipped, yellow-card, red-card. Also free-text notes.
- **Validation:** the only hard requirements are a selected match and a non-empty team number. There are two confirm prompts (team already scouted, pit-scale mismatch) and a submission-lockout check.

**Scoring**
- **Scales (docs store the index):**
  - BPS `[0,2,5,8,12,16,20,23,25]`
  - Carry `[0,12,23,32,42,53,64,74,75]`
  - Preload `[0,2,4,6,8]`
- **Cycle estimate:** `round(min(capacity, BPS * seconds))`. The first auto cycle uses preload capacity when it is above 0.
- **Section fuel:** the scored override if above 0, otherwise `max(0, estimate - missed)`.
- **Totals:**
  - `autoFuel = autoSection + autoHumanPlayer`
  - `teleFuel = transition + (parity ? shift2 + shift4 : shift1 + shift3) + teleopHumanPlayer`
  - `endgameFuel = endgameSection + endgameHumanPlayer`
  - The stored parity is `wonAuto XOR hubActivationOverride`. If it is absent, `auto.wonAuto` is used.
- **Climb points:** auto 15; endgame 10, 20 or 30 for levels 1 to 3.
- **Total score:** all fuel (1 point each) plus climb points. Failed climb, start position, incidents and penalties are not scored.
- **Stored weights snapshot:** `{autoFuel:1, autoClimbLevel1:15, teleopFuel:1, teleopClimbLevel1:10, L2:20, L3:30}`.
- **Not stored:** no total score is written to the doc. Analytics recomputes it from raw fields. Some pages read the stored `estimatedFuel` values instead of recomputing from cycles, so they can disagree.

**Other REBUILT logic**
- **Accuracy:** `1 - |scouted - official| / official`, clamped to 0..1, per alliance, against TBA official scores.
- **Verification (`scoutVerification.ts`):** auto fuel ±2, teleop fuel ±4, endgame fuel ±2, auto climb exact, endgame status exact. 85% or more is Verified.
- **Flags (`scoutingFlags.ts`):** high human-player share, auto-only, zero main scoring.
- **Prediction (`predictionEngine.ts`):**
  - Source filter: official, practice or combined.
  - Estimate: `round((avg + percentile) / (n > 1 ? 2 : 1))`, with confidence tiers 75, 85 and 90.
  - Role: Offense if the estimate is at least 25; Feeder if at least half the rows have a climb success; otherwise Defense.
- **Rescout comparison (`rescoutComparison.ts`):** field-by-field diff against an exemplar (arrays compared by average, weight 0.25).

**Known CS bugs not to port as-is**
- Every per-shift "Human Player" counter in teleop shares one state variable (`teleopHumanPlayerFuel`), so the per-shift UI is cosmetic.
- `submit()` double-computes estimates.
- REBUILT scoring is copy-pasted into about 5 files despite the shared `analyticsScoring.ts`.

### 2.4 REEFSCAPE and CHARGED_UP (legacy, CS)

- **REEFSCAPE (flat fields):**
  - Leave 3.
  - Auto coral L1-L4: 3, 4, 6, 7.
  - Auto processor 6, auto net 4.
  - Teleop coral L1-L4: 2, 3, 4, 5.
  - Teleop processor 6, net (robot) 4, net (human) 4.
  - Climb: barge/park 2, shallow 6, deep 12.
  - Plus penalty points.
- **CHARGED_UP (nested):**
  - Auto mobility 3; auto grid 3, 4, 6; auto station docked 8, engaged 12.
  - Teleop grid 2, 3, 5; links 5.
  - Endgame station parked 2, docked 6, engaged 10.
  - Plus penalty points.
- Form submission is disabled for both, but analytics columns and scoring still exist.

### 2.5 Where CS differs from CE (summary)

| Dimension | CS | CE |
|---|---|---|
| Game | FRC REBUILT 2026 (+ 2 legacy) | FTC BIOBUZZ 2026 |
| Alliance size | 3 | 2 |
| Event API | TBA (per-team key), FIRST FRC, Statbotics | FTC Events API (one server key) |
| Event id | TBA key (`2026arli`) | FIRST code (`USWABON1`) |
| Field definition | Hardcoded in page components | `Form` schema object |
| Score | Recomputed at read time | Computed at write time and stored |
| Time inputs | Cycle stopwatches (list of seconds) | No timer field type |
| Cross-field formulas | Fuel estimate, shift parity | Per-field scoring only |

## 3. CS data model

### 3.1 Conventions
- **Timestamps:** `createdAt`, `submittedAt` and `timestamp` are epoch-ms numbers, never Firestore Timestamps.
- **Identity:** `scoutId` (uid), `scoutName` (display name), `teamId` (team code). Several queries join on `scoutName`.
- **Context fields:** `eventKey`, `game`.
- **Edit mode:** the URL params `editId` and `editCollection` are used directly as the collection name in `setDoc`.
- **Auth:** Firebase Auth (email and Google), `browserLocalPersistence`. Profile loads from `users/{uid}`. There is a hidden owner permission layer from env allowlists. A second `onSnapshot` on the team doc exists only for `timeOverride`.
- **Rules:** no `firestore.rules`, `firebase.json` or `storage.rules` in the repo. Rules live outside it. Fallback ladders in client code hint at rule drift (6 payload shapes for join requests, `leadScouting` falls back to `scouting`, assignment writes catch permission errors).
- **Isolation:** most analytics pages read whole collections with no `teamId` filter.

### 3.2 Collections

**`users/{uid}`**
- **Fields:**
  - `uid, email, displayName`
  - `role` (single), `roles[]`, `secondaryRoles[]`, `specialRole(s)`
  - `teamId, isTeamAdmin`
  - `photoURL, bio, profileVisibility` (`team | public | private`), `profileComplete`
  - `preferredDashboard` (a route path)
  - `canManageVersionReleases, emailVerificationExempt`
  - `accountThemeId, accountFontId, experiencedScout, createdAt`
  - `encryptedUserData, userDataEncryptedAt` (write-only copy sent through `/api/user/encrypt`, never read back)
- **Valid roles:** `match-scout, pit-scout, pit-team, drive-team, lead-scout, lead-strategist, team-coach, media, judge-awards`. Legacy values (`scout`, `coach`, `lead_scout`, and others) are normalized in `utils/roles.ts`.
- **Queries:** `where teamId ==`, `where email ==`.

**`teams/{TEAMCODE}`**
- **Doc id:** the uppercase join code. Other docs' `teamId` points to it. Some lookups also try `where teamId ==` on the teams collection.
- **Identity and events:**
  - `teamName`, `teamNumber` (string), `verifiedOwnerId`
  - `selectedEvents: string[]` (TBA keys), `eventAttendees: {eventKey: (uid|name)[]}`
  - `tbaApiKey` / `tbaApiKeyEncrypted`
- **Controls and settings:**
  - `formAccessOverrides: {formKey: uid[]}`
  - `timeOverride {enabled, offsetMs, updatedAt, updatedBy}`
  - `submissionControls {globalLockout, lockoutReason, updatedAt, updatedBy}`
  - `metricVisibilityRules[]`, `publicMetricAnonymization`
- **Assignment helpers:** `manualTeamListsByEvent`, `priorityTeams*` (several aliases), `scoutCount`, `eventScoutCounts`.
- **Pick list and forms:** `pickList`, `activePitFormPresetId`, `activePitGame`, `activeMatchFormPresetId`, `activeMatchGame`.
- **Legacy embedded data:** `judgeBookCards[]`, `judgeBookUpdatedAt`, and release notes.
- **Problem:** a hot catch-all document, read about 49 times across 39 files.

**`scouting`** (auto id): the largest collection, and it holds several kinds of rows. Every analytics query must exclude the non-official kinds (`entryMatchesAnalyticsFilters` does this).
- **Row kinds:** official REBUILT entries; practice rows (`isPracticeScouting`, `practiceMode`, `practiceSessionId`, `difficulty`, `accuracy`, `device*`); sub-in requests and claims (`entryType: "sub-in-request" | "sub-in-claim"`, `requestedAt`, `requestedById/Name`); lead-scout rows written through the permission fallback; legacy REEFSCAPE rows.
- **Official REBUILT payload:**
  - Identity: `scoutName, scoutId, teamId, eventKey, game:"REBUILT", matchId` (`p3 | q12 | qf2 | sf5 | f1`), `matchType` (`practice | qualification | finals`), `matchNumber` (string), `teamNumber` (string), `startingPosition`.
  - `auto { preloadScale, bpsScale, carryingScale, cycleTimes[], estimatedFuel, counterOverride, counterOverrideMissedFuel, humanPlayerFuel, failedClimb, successfulClimb, wonAuto, hubActivationOverride }`
  - `teleop { shiftParityFromWonAuto, bpsScale, carryingScale, transitionCycles, shift1Cycles..shift4Cycles, transitionOverride, transitionMissedFuel, shiftNOverride, shiftNMissedFuel (N = 1..4), humanPlayerFuel, estimatedFuel }`
  - `endgame { cycleTimes, counterOverride, counterOverrideMissedFuel, humanPlayerFuel, estimatedFuel, failedClimb, status }`
  - `incidents[], notes, scoringWeights, submittedAt, timestamp`.
- **Practice rows add:** `matchKey, eventName, alliance/allianceColor, accuracy, penaltyPoints`.
- **Analytics adds:** `accuracy`, `accuracyDetails`, `excludeFromStats`.
- **Missing:** there is no `source` field. Practice vs official is inferred from flags or label sniffing (`normalizeMatchLabel` has dozens of typo-tolerant regexes).
- **Queries:** `where eventKey ==`, `where scoutId ==`, `where scoutName ==`, `where teamId == and entryType ==`, plus whole-collection `getDocs`.

**`pitScouting`**
- **Fields:**
  - `teamNumber, robotWeight, rookieTeam, robotPictureUrl` (URL text, not Storage)
  - `pitDisposition, driveDisposition`
  - `fuelPreloadCapacity, fuelBallsPerSecond, fuelCarryingCapacity` (strings, often ranges such as "10-13")
  - `climbLevel1..3, typicalFuelCycleTime, typicalClimbTime, autoCycleDescription, notes`
  - `scoutName, game:"REBUILT", eventKey, teamId, submittedBy, createdAt, submittedAt`.
- **Coupling:** the match form reads these through `parsePitValue` to prefill scales and warn on mismatch. It tries `teamId + teamNumber + game` first, then falls back to all REBUILT pit docs from any team.

**Other form collections**
- **`strategyScouting`:** `teamNumber, preferredStartingPosition, bestAt, clearsBump, clearsTrench, canShootWhileIntaking, canMoveAndShootSimultaneously, notes`.
- **`matchStrategyPlans` and `driveScouting`:** `matchKey, matchLabel, robots[3]{teamNumber, startingPosition, role, autoClimb, endgameClimb, climbProbability?, estimatedPoints?, predictionSampleSize?}, notes`.
- **`helperReports`:** `helperName, helperId, assistedTeamNumber, wasSuccessful, issueSolved, notes`.
- **`leadScouting`:** `alliance, robots[3]{teamNumber, notes, skillLevel 1-5}, overallAlliance{teams, notes, skillLevel}, isLeadScouting, entryType:"lead", matchKey/matchId/matchLabel/matchType/matchNumber, isPracticeScouting`.

**Assignments, practice and live**
- **`matchAssignments`:** one doc per scout and match. Fields: `teamId, eventKey, matchKey, matchLabel, scoutId, scoutName, teamNumber` (number), `scoutHumanPlayer, assignedBy, assignedAt`. Team-strategy assignments reuse it with `assignmentType:"team", matchKey:"team"`.
- **`pitAssignments`, `teamAssignments`:** same shape without match fields.
- **`practiceAssignments`:** adds `practiceMatchId, matchKey "pN"`.
- **`practiceMatches`** (seeded by scripts, one doc per alliance per match, only matches with a YouTube video):
  - `matchKey, eventKey, eventName, matchNumber, matchType, compLevel, setNumber, videoUrl, difficulty`
  - `alliance, allianceTeams` (up to 3 numbers), `actualScore, officialScore, penaltyPoints`
  - `officialData {score, penaltyPoints, breakdown}`, `game, createdAt, importedByScript`.
- **`practiceSessions`:**
  - Session fields: `teamId, scoutName, scoutId, matchId/Key/Number/Type, alliance, difficulty, mode` (`trial | competitive`), `isLivePracticeScouting, liveVideoUrl, scoutedData, allScoutedData[], eventKey, eventName, game, officialScore, actualScore, scoutedScore, penaltyPoints, accuracy, scoringWeights, device*, timestamps`.
  - It is overloaded as the live-lobby store (`code, hostId, status, playersByUid, matchJson, assignmentsJson, submissionsJson`).

**Governance and social**
- **`teamJoinRequests`:** `userId, userEmail, userEmailLower, userName, userRole, requestedRole, teamId, status` (`pending | approved | denied | canceled`), `createdAt, processedAt, processedBy, canceledByUser, profileSyncPending, profileSyncedAt, teamDisplayLabel`.
- **`accuracyRescouts`:** `teamId, eventKey/Name, matchKey/Label, game, alliance, teamNumber, scoutId/Name, status, accuracy, criticalFlag, createdAt, updatedAt, originalScouts[]`.
- **`scoutingFlagStates`:** doc id `"{entityType}:{entityId}"`, with `teamId, entityType, entityId, dismissed, manualFlagged, manualReason, excludeFromAccuracy, excludeReason, *At/*By`. Entity types: scoutingEntry, practiceSession, leadScouting, pitScouting, strategyScouting, matchStrategyPlan, driveScouting, helperReport.
- **`formPresets`:** `teamId, name, formType` (`match | pit`), `game` (`REEFSCAPE | REBUILT`), `fields[]{id, label, type, section, options, scaleLabels, required}, updatedAt`. Applies to REEFSCAPE forms only.
- **Small collections:** `teamAnnouncements` (`teamId, authorId/Name, body, type, createdAt`), `judgeBookCards`, `versionReleases` (both with primary storage embedded in the team doc and a legacy collection fallback), and `subInRequests` (written only by a dead API; sub-ins really use `scouting`).

### 3.3 Event and match storage
- **Selected events:** per team, in `teams/{id}.selectedEvents`. A user's current event is auto-detected from dates, falling back to `"app-testing"`.
- **Schedules:** never stored. Fetched live from TBA (FIRST for practice) on every form and dashboard load.
- **Aliases:** `normalizeEventKey` and `expandEventKeyAliases` map old keys to current ones. Queries run once per alias.
- **localStorage keys:** `analytics-selected-game`, `analytics-selected-event`, `analytics-practice-matches-only`, practice drafts (per uid), `practice-live-lobbies`, theme caches, `cs-notification-prompted`, cookie consent.

### 3.4 CE vs CS data compatibility

| Concept | CS | CE | Compatible as-is? |
|---|---|---|---|
| Match entries | `scouting`, nested, no `formId`/`source`, no stored score | `scoutEntries`, flat `values`, stored `score`, `formId`, `source`, `formVersion` | **No.** CE queries `where source == "event"`, so CS docs are silently excluded. |
| Name | `displayName` | `name` | No |
| Role | `role` + `roles` + `secondaryRoles` | `primaryRole` + `secondaryRoles` | No |
| Admin | `isTeamAdmin` | `isAdmin`, `isOwner`, `isPlatformOwner` | No. CE rules deny CS admins. |
| Team doc id | human code | auto-id | No |
| Team number | string | number | No |
| Events | `selectedEvents` (keys) | `activeEvents` (full objects, max 10) | No |
| Event key | TBA lowercase | FIRST code | No |
| Match key | `q12`, `sf5`, `f1` | `Q12`, `P3`, `F2` (`^[PQF]\d{1,4}$`) | No. Playoffs differ. |
| Team/match numbers | strings (assignments: numbers) | numbers | No |
| Timestamps | epoch ms | ISO string / Firestore `Timestamp` | No |
| Flags | `scoutingFlagStates` docs | inline `excluded`, `autoFlags`, `manualFlags` | No |
| Accuracy | number (percent) + `accuracyDetails` | `{status, value 0-1, scoutedTotal, penaltyPoints, officialScore}` | No |
| Assignments | flat `matchAssignments` | `assignments/{teamId}_{eventCode}` with versioned `slots[]` | No |
| Sub-in | `scouting` rows with `entryType` | no equivalent | n/a |
| Join flow | approval queue (`teamJoinRequests`) | join code + `teamApplications` | No |
| Rules | not in repo | 63KB `firestore.rules`, fail closed | n/a |

CE's `lib/forms/legacy.ts` means CE's *own* pre-schema-v2 BIOBUZZ back-compat. It knows nothing about CS.

A read-adapter (`scouting` doc to a normalized entry) would need to:
- Skip sub-in, lead and practice rows.
- Map `eventKey`, `scoutId` and `notes` to the normalized names.
- Parse numbers and convert timestamps.
- Fold `qf/sf/f` ids into a playoff convention.
- Flatten the nested objects.
- Compute the score with CS's own functions, so historical numbers match what CS shows.
- Merge `scoutingFlagStates`.
- Treat a missing `game` as REEFSCAPE.

## 4. CE stack and conventions

| Topic | CE |
|---|---|
| Framework | Next.js **16.3.3** App Router, React **19.2.8**. CE's `AGENTS.md` says this Next has breaking changes: read `node_modules/next/dist/docs/` before coding. |
| Language | TypeScript 5, `strict: true`, alias `@/*` to the repo root |
| Lint / format | ESLint 9 flat config (`eslint-config-next` core-web-vitals + typescript, React 19 compiler rules on). **No Prettier.** |
| Styling | Tailwind **4** via `@tailwindcss/postcss`, no `tailwind.config`. Components use arbitrary values such as `text-[var(--muted-foreground)]`. |
| Tokens | `lib/themes.ts` registry (9 solid, 12 gradient, 18 pride themes, default `team`). `lib/theme-tokens.ts` builds per-theme and per-mode tokens fitted to 4.5:1 contrast. `lib/theme-css.ts` emits `html[data-theme][data-mode]` rules into `<head>`. `scripts/check-theme-contrast.ts` runs in `prebuild`. |
| CSS rules | `-webkit-backdrop-filter` must precede `backdrop-filter` (guarded by a test); no Tailwind `backdrop-blur-*`; `dvh` not `vh`; 44px touch floor on coarse pointers; 16px form text under 1024px; reduced-transparency fallback; lighter blur under 768px. |
| UI library | `components/ui/*` shadcn-style: Radix (checkbox, dialog, select, switch, tabs), `cva`, `cn()`, lucide-react, framer-motion (64 files). Also dnd-kit and `@tanstack/react-virtual`. |
| Shell | `app/layout.tsx`: `AuthProvider` > `ThemeProvider` > `GlassLayerProvider` > `MotionProvider` > `BackgroundBlobs`. `app/(app)/layout.tsx` (client): auth redirect, `FieldTeamsProvider`, `PageAccessProvider`, `FormsProvider`, sidebar, topbar, banners, `PageGuard`. Route groups `(app)` and `(marketing)`. |
| Nav | `lib/nav.ts`: `mainNav` (17), `secondaryNav` (5), `analyticsNav` (13), filtered by page access. |
| State / data | React context only. `use*` hooks over `onSnapshot` (about 25 files) and `getDocs` (8). Pure logic is split from Firebase code. |
| Server | Server Actions for FTC data (`lib/ftc/actions.ts`, 3-minute server cache). Bearer-token API routes through `authedApi()`. Session cookie via `/api/auth/session`. Helpers in `lib/server/*`. |
| Offline / PWA | Firestore `persistentLocalCache` with a multi-tab manager. IndexedDB photo upload queue. `ConnectionChip` shows pending sync count. Manifest present. **No app-shell service worker**, so no offline page load. |
| Tests | Vitest (94 test files) plus Playwright (4 projects: Chromium and WebKit, desktop and phone) plus Firestore-emulator rules and API tests |
| Deploy | Vercel (one daily cron), Firebase rules and indexes |
| Naming | kebab-case files, domain folders in `lib/` and `components/`, tests beside modules. Code comments carry prompt ids (P1-P32, FIX1-FIX4) that map to headings in `docs/ASSUMPTIONS.md`. |
| Env vars | FTC credentials, `NEXT_PUBLIC_FIREBASE_*`, Firebase Admin trio, `CRON_SECRET`, `OWNER_EMAILS`, Turnstile, Resend, `APP_URL`, `APPLICATION_SECRET`, `BLOB_READ_WRITE_TOKEN` |
| Forms engine | `Form` schema (`lib/forms/types.ts`, zod in `validate.ts`). Field types: toggle, counter, checkbox, number, text, textarea, select, radio, rating, slider, image, sequence, matrix, plus system pickers. Each field carries `scoring` (none, whenOn, perTally, perUnit, byOption), `analytics`, `statRoles`, `unrealisticAbove`, `visibleWhen`, `ui`. Versions are immutable and built-ins are overridden copy-on-write. |
| Docs worth reading | `docs/ARCHITECTURE.md` P21 (form engine), P17 (mobile), P18 (themes), P26 (page access), Conventions; `docs/ASSUMPTIONS.md` P1-10 and FIX3-12 (offline); `docs/mobile-audit.md`. Both big docs total about 530KB, so do not copy them wholesale. |

CS stack for contrast: Next 16.1.6, React 19.2.3, Firebase 12.8, **Tailwind 3.4**, recharts, lucide-react, dotenv, **no tests**, no shared shell, no state or data library.

## 5. Unfinished and placeholder pages

**CE**
- The `REALIZED_PAGES` array in `app/(app)/layout.tsx` is stale. It omits `/analytics/lead-scout`, `/pit-scout`, `/team-strategy`, `/match-strategy`, `/drive-reflection` and `/helper`, which are real, so they wrongly show the "Placeholder page" banner. `PlaceholderBanner`, `REALIZED_PAGES` and `lib/mock-data.ts` are dead weight.
- `ComingSoonCard` stands in for Media tools and Judge notes on the dashboard.
- `/team-settings` is not in the page-access registry, so it is ungated except for its own checks.
- Six analytics pages and six form pages are 6 to 17 line wrappers over real shared components. They are not stubs.

**CS**
- Do not port: `scout-form-placeholder`, `pit-scout-form-placeholder`, `profile-[userId]`, the dead `sub-in-requests` API, the disabled REEFSCAPE submit paths, the disabled CHARGED_UP submit, the disabled CSV import/export buttons in analytics, and `RoleDashboard`, `TeamRequests`, `TeamRequestsPanel`, `TBAKeySettings`, `FinalsMarchSelector`, `utils/tbaHelpers.ts`, `utils/accuracyStatus.tsx`, `hooks/useScoutAccuracy.ts` (all unused).
- `form-builder` is real but not connected to the live REBUILT forms.

## 6. Performance and structure problems

### 6.1 CS
- **Read volume:** about 165 `getDocs`, 3 `onSnapshot`, 49 team-doc reads in 39 files. About 10 pages read the whole `scouting` collection. `calculateTeamStats` reads 6 full collections (`scouting` plus per-member queries by `scoutName`, `pitScouting`, `strategyScouting`, `matchStrategyPlans`, `driveScouting`, `helperReports`).
- **Waterfalls:**
  - Role dashboard: sequential loads (stats, upcoming events, practice sessions, assignments, sub-ins, team doc, TBA matches per event).
  - Scout form: about 7 sequential awaits (event, assignments, TBA matches, FIRST schedule, completed matches, event assignments).
  - Analytics: N+1 `getDoc` over practice sessions.
- **Keys:** `scoutName` joins instead of `scoutId`.
- **Polling:** 20 s sub-in poll per open dashboard.
- **Event resolution:** 14 files resolve the event independently, and 18 files call the TBA match endpoint.
- **No shared shell:** 35 pages import `Sidebar` individually and wrap themselves in `ProtectedRoute`.
- **Giant files:** `practice-scouting` 288KB, `assignments` 211KB, `analytics/page` 155KB, `scout-form` 145KB, `scout-accuracy` 112KB, and seven more over 40KB.
- **Duplicated logic:** REBUILT scoring and scale tables (about 5 files), `CycleTimer`, `ClimbCounter` and `TeamPickerModal` (3 pages each).
- **Dead code:**
  - About 200KB of root `__hist_*` and `__orig_*` files, empty `Cycles` and `Delete` files (all type-checked because of the tsconfig include).
  - 21 one-off scripts inside `app/`.
  - Unused components and modules (section 5).
- **Dependencies:** `dotenv` is a runtime dependency used only by scripts. `recharts` is used by 2 files. `tailwind.config.js` scans a nonexistent `./components/**`.
- **UI quality:**
  - 325 `alert()` and 40 `confirm()` calls.
  - About 600 hardcoded Tailwind colors and 124 inline hex values against about 414 `var(--*)` uses, so dark themes do not fully apply.
  - About 26 ARIA attributes in the whole app and 7 `alt=` attributes.
  - 2 raw `<img>` tags with user URLs.
  - Color-only status chips.
- **Scout form:**
  - No draft or autosave.
  - After submit it shows an `alert()` and calls `window.location.reload()`.
  - Counter buttons are 32px (`.theme-stepper-btn`).
  - Delete-cycle buttons are tiny (`px-2 py-0.5 text-xs`).
  - Uses `h-screen`, and there is no `inputMode` on the team-number field.
- **Security and privacy:**
  - `NEXT_PUBLIC_TBA_API_KEY` and a FIRST token are exposed to the browser.
  - `/api/tba/encrypt` and `/api/user/encrypt` have no auth.
  - Server routes use a shared "migration user" or a static access token to call Firestore REST.
  - `editCollection` from the URL is used as a collection name.
  - Cross-team reads are open.
- **Correctness:** `new Date().getFullYear()` is used for event lists (breaks across year boundaries). The shared per-shift human-player state and the hooks-after-return bug (section 2.3 and 1.2).
- **Missing infrastructure:** no tests, no Firestore rules in the repo, no PWA/manifest.

### 6.2 CE
- **Duplicate listeners:** `useTeamScoutEntries(teamId)` queries all of a team's entries across events and seasons with no limit. It is mounted in 7 or more places (dashboard provider, analytics provider, `/event`, `/scout`, `use-scout-stats`, `use-form-admin`, rescore panel). `useTeamDoc` is called 14 times and `useActiveEvents` in 16 files. The Firestore SDK dedupes identical listeners locally, but memory use and full-collection reads remain.
- **Waterfalls:** event switch goes team doc, then FTC server actions, then entries. The caches in `use-ftc-query.ts` and `use-event-data.ts` are separate module-level maps with duplicated TTL logic.
- **Write amplification:** `recomputeForEvent` re-reads and rewrites a whole event's accuracy and flags on every save (fire-and-forget, O(n) writes per save).
- **Scout mount:** `/scout` loads all team entries only to compute the next assignment.
- **Large files:** `lib/forms/edit.ts` (751 lines), `components/scout/scout-form.tsx` (657), `components/forms/builder/builder.tsx` (535), `form-summaries-view.tsx` (527), `scouting-workspace.tsx` (508).
- **Unused dependencies:** `@opentelemetry/api`, `@radix-ui/react-label`, `@radix-ui/react-slot` have no imports.
- **Shipped test code:** 12 `app/e2e/*` fixture pages are in the production build.
- **Dead code:** `lib/mock-data.ts`, `PlaceholderBanner`, `REALIZED_PAGES`, the default `public/*.svg`, a `lib/scout-form/schema.ts` compatibility facade, the create-next-app README.
- **Heaviness:** 39 themes generated into `<head>`; framer-motion on most primitives (64 files).
- **Offline:** no app-shell service worker. `saveEntry` awaits `addDoc`, which resolves only on server acknowledgement, so an offline submit may stay on "Submitting..." even though the entry is queued *(unverified)*. No in-progress entry draft. The pending count is scoped to active events only.
- **Mobile audit:** `docs/mobile-audit.md` is a static checklist and was not tested on devices.

## 7. The four core pages: CS vs CE

### 7.1 Event Select

| | CS `/event-selection` | CE `/event` |
|---|---|---|
| Reads | `teams/{id}.selectedEvents` and team TBA key (two separate reads); POST `/api/tba/events` for the current calendar year; falls back to two hardcoded events | Team doc (`onSnapshot`); FTC events via Server Action `getEvents({season})`; entry counts per event |
| Writes | `setDoc(teams/{id}, {selectedEvents}, {merge:true})` | `updateDoc(teams/{id}, buildActiveEventsFields(state))`, max 10, order is priority |
| Gating | Any signed-in member | Admin only (also enforced by rules) |
| UX | Checkbox list, name dedupe (can hide two real events with one name), `alert()` | Season picker, search, status filter, sort, dnd-sortable selected panel, primary event, confirm on removing an event that has entries |

### 7.2 Dashboard

| | CS | CE |
|---|---|---|
| Shape | `/dashboard` is no-team onboarding only. Nine role routes share `TeamRoleDashboard`. | One page, widget registry per role, role switcher, header strip (rank, record, next match) |
| Reads | Sequential: team stats, upcoming events, `practiceSessions` by `scoutName`, `matchAssignments` by `scoutId`, sub-ins (2 queries), team doc, TBA matches per event, optional pit/drive/FIRST | `DashboardProvider` subscribes only to the sources a role needs (`ROLE_SOURCES`) |
| Writes | Sub-in request, claim and delete (inside `scouting`) | None (saved role preference in localStorage) |
| Extras | Notification opt-in, 20 s poll, quick actions | `WidgetBoundary` error isolation, `ComingSoonCard` for Media and Judge |

### 7.3 Match Scout Form

| | CS `/scout-form` | CE `/scout` |
|---|---|---|
| Definition | Hardcoded in a 3,007-line page | `Form` schema rendered by `components/scout/scout-form.tsx` (657 lines) |
| Write | `addDoc(scouting)` (CS shape), then `alert()` and a page reload | `addDoc(scoutEntries)` via `entryPayloadFor`, then `recomputeForEvent` |
| Match pick | Modal with practice/qualification/finals tabs and a double-elim bracket; team picker marks Scouted, Assigned, Sub Req and Sub Assigned | `match-picker-dialog`, `team-picker-dialog`, `bracket-picker`; "Next assignment" banner; `?event=CODE&load=next` deep link |
| Extras | Pit-sync prefill and mismatch warning; sub-in request flow; duplicate-scouted confirm; lockout; edit mode (`?editId&editCollection`); lead mode | Sticky score bar, section nav, sticky-notes panel; reused for practice, live and lobby modes and the admin entry editor |
| Draft/offline | None | Firestore offline queue; no draft *(submit-hang unverified)* |
| Tap targets | 32px counters, tiny delete buttons | 48px counters, 48px radio tiles, `inputMode` numeric, 44px floor, safe-area padding |

**Can REBUILT be a CE `Form`?**

| REBUILT element | Expressible in CE today? |
|---|---|
| Identity pickers, start position (select/radio), toggles, counters, incidents (checkboxes), notes (textarea) | Yes |
| Endgame status with points 0/10/20/30 (`byOption`), auto climb (`whenOn` 15) | Yes |
| BPS / carry / preload scale sliders with per-step range labels | Partly. `slider` has only end labels and ticks. The index-to-number maps live in code. |
| 7 cycle stopwatches storing a list of seconds | **No.** `sequence` stores step ids, not durations. Needs a `timerList` field type. |
| Fuel estimate, `min(capacity, bps*seconds)`, first-cycle preload, override-else-estimate-minus-missed | **No.** Scoring is per field, with no cross-field formulas. |
| Shift parity (`wonAuto XOR hubActivationOverride`) | Partly. `visibleWhen` supports one-field conditions only. |
| Pit-sync warnings | No (cross-form logic) |
| Sub-in, assignment banners | Partly. CE has a Request Sub-In control but a different data model. |

Gap estimate: medium to large. About 60% of fields map directly. The remainder needs a `timerList` field type (touching `types.ts`, `validate.ts`, `values.ts`, the renderer, `game-schema.ts`, CSV and the builder), a custom scoring hook, per-step slider labels and a REBUILT flag rule set.

### 7.4 Match Scout Analytics

| | CS `/analytics` (155KB) | CE `/analytics/match-scout` |
|---|---|---|
| Data | `getDocs(scouting)` (all teams), N+1 practice session lookups, `scoutingFlagStates`, TBA per event | One `AnalyticsDataProvider` subscription, virtualised table, URL-backed filters |
| Columns | Three hardcoded branches by game | `buildGameSchema(form)` derives columns from the form |
| Filters | Game, event, practice-only (persisted in localStorage), sort, hide names | Game, events, practice, accuracy threshold |
| Actions | Manual flag/dismiss, exclude from stats, recalc accuracy, delete; CSV import/export exist but are **disabled** | Config modal (flags, exclude, edit, delete), CSV import/export, recalculate, hide names |
| Scoring | Recomputed per row at read time | Stored score plus form-driven columns |
| Accuracy | Number plus `accuracyDetails` | `{status, value, scoutedTotal, penaltyPoints, officialScore}`, 2-robot alliances |
| Scope | Cross-team reads | Team-scoped |

## 8. Recommendation: how much should become config-driven

Three tiers, each in its own folder in the rebuild:

1. **Config (declarative, a config swap per event):**
   - Game id and season.
   - Scale tables, point values, tolerances and thresholds.
   - Field lists, option labels, incident lists and phase names.
   - Event aliases and date windows.
   - Alliance size (3).
   - Provider settings.
   - Lives in one `config/` layer.
2. **Declarative form through CE's `Form` engine:** ship REBUILT as a code-defined built-in (like BIOBUZZ) so the scout form, analytics columns, CSV and flags are derived from it. Extend the engine with a `timerList` field type and per-step slider labels.
3. **Code plugins keyed by game id (not config):**
   - Fuel estimation, shift parity, flag rules, rescout comparison and prediction.
   - A small plugin interface (`score`, `flags`, `normalize`) behind a registry.
   - Formulas stay testable code. They are not squeezed into JSON, because that would hide logic in an untestable place.
   - Golden tests run against real CS documents, as CE did for BIOBUZZ.

Data access: keep the CS Firestore schema, since the brief forbids changing it without approval. Put typed read-normalizers and CS-shaped writers in one `data/` layer instead of adopting CE's `scoutEntries` and `formEntries`. CE's FTC event layer is replaced by an FRC provider (TBA first, the FIRST API for practice schedules). If legacy games are kept, they are read-only through the same plugin interface.

Net effect: a future event becomes a new `config/` entry, optionally a new form definition, and a plugin only when its scoring has cross-field logic.

## 9. Riskiest parts of the port

1. **FTC to FRC rewrite of CE's event layer** (about 8 `lib/` domains plus the FTC-shaped types). It sits under all four core pages and is the largest hidden cost.
2. **Score and flag parity.** CS recomputes scores at read time from raw fields. A one-rule difference would shift historical rankings and accuracy. Golden tests are required.
3. **Data and access control.** CE's rules fail closed, so one missing field silently hides data or locks out admins. CS's real rules are unknown.
4. **Offline submit on venue Wi-Fi.** Neither app has an entry draft, and CE's submit may hang offline *(unverified)*.
5. **Two sources of truth if CS runs in parallel.** CS pages read whole collections and will ingest anything the rebuild writes into `scouting`.
6. **Form-engine extensions.** A timer field and a custom scoring hook have a wide blast radius, though CE's heavy test coverage helps.

## 10. Open questions

**Blocking for Phase 1 and 2**
1. **Data strategy.** Keep CS's collections behind a normalizer and adapter layer (recommended), or migrate CS data into CE's shapes? Is there a staging Firebase project, and can you provide CS's Firestore rules?
2. **Cutover.** Parallel run (rebuild must write CS-shaped docs, and share data with live CS) or hard cutover with CS frozen?
3. **Games in scope.** REBUILT only, or REEFSCAPE and CHARGED_UP as read-only analytics too? Drop the disabled submit forms?
4. **Event and match APIs.** Keep per-team TBA keys or use one server key? Which of TBA, FIRST FRC API and Statbotics are required?
5. **FTC code in CE.** Remove entirely, or keep as a second provider?
6. **Permissions.** Keep CS's role model, legacy aliases and owner allowlists, or move to CE's owner and page-access model? Who may set the event selection (any member today in CS, admins only in CE)?

**Scope**

7. **CE-only features.** My default is to keep credits, my-scouting, changelog, page-access, audit log and the admin shell; stub apply flow, templates, form builder, backups and rescore. Confirm or adjust.
8. **CS-only features.** Sub-in requests, judge-book, team announcements, match-prediction, robot-radar, accuracy-compare and verification, event-details: port, stub or drop? Sub-in needs a new home collection (currently rows in `scouting`).
9. **Theme.** Use CE's `team` theme (red and gold) as the default, or recreate CS's red as a CE theme?

**Behavior**

10. **Shared per-shift human-player value in REBUILT.** Fix it (one counter per shift) or keep the stored shape?
11. **Cross-team analytics reads in CS.** Intentional? CE scopes by team, which would change what users see.
12. **Playoff id convention.** CS uses `qf/sf/f` plus numbers. CE has one `Playoff` type plus a number. Proposed: bracket matches 1 to 13 and finals 14 to 16 (the mapping CS already uses in `normalizeScoutedMatchId`). Confirm.
13. **`encryptedUserData`.** Migrate, keep or drop?
14. **Lead scouting.** Keep CS's `leadScouting` collection or route it to a form-entry equivalent?

# CompSocrates v2.0.0: facts for the changelog

Branch `release-prep`. Baseline = tag `live-before-v2` (98071e9, 2026-04-04), compared with `git ls-tree` / `git show` / `git grep`. Every row was checked in code (proof column). **Status:** ON = on by default in code; OFF = behind a setting that defaults off; SETUP = needs keys or setup; UNREACH = code exists, not reachable. **No row was opened in a browser by me**, and no results file proves a real-app browser pass (REMAINING.md: "No FTC page has been opened in a browser"; SESSION_I: e2e ran on fixture pages only). Docs mention owner manual checks of Batch 4 and 5a; not verified here.
Legend: Prog = F (FRC), T (FTC), F+T. Cat = New / Improved / Fixed / Removed (section 4 also uses Changed, Moved).

## 1. NEW since v1.6.0
Not new for FRC (the old app had them): Live practice, Lobby practice, Trial/Competitive modes (old `practice-scouting/page.tsx`), Scout Accuracy page, themes, profile visibility, sub-in requests, Robot Radar, Performance Reliability, Pick List. Do not list them as new for FRC.

| Label in app | Prog | Cat | One line | Proof | Status |
|---|---|---|---|---|---|
| FTC (whole program) | T | New | FIRST Tech Challenge teams get CompSocrates, game BIOBUZZ, 2-team alliances | `config/programs/ftc.ts`, `config/games/ftc/biobuzz.ts` | ON |
| Program cards "FRC" / "FTC", top-bar chip, sidebar switch | F+T | New | Pick your program on the home page; the app remembers the last one | `components/program/program-switcher.tsx`, `app/(marketing)/page.tsx` | ON |
| FTC pages that open (labels) | T | New | Active Events, Assignments, Dashboard, Match List, Match Scout Form, Lead Scout / Match Strategy / Drive Reflection / Pit Scout / Team Strategy / Helper forms, Practice Scouting, Scout Accuracy, My Scouting, People, Achievements, Credits, Team Management, Team Settings, Account Settings, Admin Panel, Changelog, Event Details | `connection.paths` in `ftc.ts` | ON |
| FTC Analytics pages | T | New | Analytics hub, Match Scout Analytics, Lead Scout, Pit Scout, Team Strategy, Match Strategy, Drive Reflection, Helper Analytics, Team Averages, Match Breakdown, Rankings, Team Breakdown, Pick List, Scout Status, Performance & Reliability, Robot Radar | `ftc.ts` paths, `lib/nav.ts` `analyticsNav` | ON |
| FTC pages NOT there | T | n/a | Accuracy Compare, Accuracy Verification, Match Prediction, Judge Book are hidden in FTC; Sub-ins, Team Applications, Team Communication are off | `FTC_UNAVAILABLE_PATHS`, `features` in `ftc.ts`; sidebar hide commit | ON (absent) |
| FTC event data (names, schedule, teams) | T | New | Event names/schedules come from the FTC Events API; without keys pickers fall back to manual entry | `lib/ftc/`, CLAUDE.md "FTC event data" | SETUP (`FTC_API_USERNAME`, `FTC_API_KEY`) |
| Practice Scouting > Live, Live Practice Lobby | T | New | Scout a real livestreamed FTC match, or practice together in a lobby | `components/practice/difficulty-select.tsx`, `ftc.ts` `live`/`lobby: true` | ON; SETUP for real streams/scores |
| Match Library (Admin) | F+T | New | Admin tab with Imported and Manual match tabs, scores optional for FTC | `components/admin/match-library-panel.tsx` | ON (old app's equivalent not checked) |
| Alliance roles "You are scouting: Hive/Garden" | T | New | One scout per alliance records Hive, the other Garden, so objectives are not double counted | `lib/forms/alliance-role.ts` | ON |
| Analytics hub + "Raw data" group | F+T | New | Analytics opens a hub; the entry tables sit under "Raw data"; old `/analytics` table is now Match Scout Analytics | `lib/nav.ts`, `app/(app)/[program]/analytics/` | ON |
| Match Prediction | F | New | Predict match outcomes (only on the unreleased `preview` branch before) | `analytics/match-prediction/page.tsx`; absent from tag | ON |
| Team Communication (Team Management) | F | New | Team posts: announcements, strategy notes, match alerts; admins delete (only on `preview` before) | `components/announcements/`, `frc.ts` `announcements: true`; absent from tag | ON |
| Achievements (page, profile section) | F+T | New | Badges and progress bars; others see earned only | `achievements/page.tsx`, `components/achievements/` | ON |
| Admin Panel > Achievements | F+T | New | Admins rename built-in achievements and make their own | `components/admin/achievements-panel.tsx` | ON |
| My Scouting | F+T | New | Your own scouting history; Role filter, Event filter, Game select offer only what applies to you | `my-scouting/page.tsx`, `lib/scout-stats/my-scouting-filters.ts` | ON |
| Credits (page + footer link "Credits") | F+T | New | Public `/credits` and an in-app Credits page; footer link on public pages and in the app | `app/(marketing)/credits/page.tsx`, `components/layout/site-footer.tsx` | ON; content SETUP (see 7) |
| Changelog: one site-wide feed | F+T | New | Notes tagged FRC/FTC/both; "Show all programs" switch; legacy notes below; unread dot | `changelog/page.tsx`, `lib/platform-changelog/model.ts` | ON; entries SETUP (owner writes, legacy import not run) |
| Account Settings > Appearance | F+T | New | Light/Dark/System, Gradient intensity (Subtle/Normal/Vivid), theme search, groups Solid/Gradients/Pride, "All my devices" / "This device only" | `components/theme/appearance-panel.tsx` | ON |
| Event year in names | F+T | New | Events show the year ("2026 ..."; FTC "2025-26") | `lib/events/names.ts`, SMOKE_TEST item 5 | ON; SETUP (TBA key for names) |
| Archived events | F+T | New | "Archive all previous seasons (n)", collapsed "Archived" list in Event Select; "Show archived events" switch in Analytics and Assignments | `components/event/archived-events-section.tsx`, `event-multiselect.tsx`, `assignments/page.tsx` | ON |
| Admin Panel > Sidebar | F+T | New | Admins drag to reorder, group, rename, hide pages; default has a "Forms" group | `components/admin/sidebar-panel.tsx`, `lib/sidebar/layout.ts` | ON |
| Admin Panel > Page Access (Requests, Roles, Members) | F+T | New | Choose which roles open which pages; "Request access" on a closed page; All Members matrix | `components/page-access/` | ON |
| Account Settings > Privacy and profile | F+T | New | Picture, display name, pronouns, bio, "Public to my team" or "Private"; admins see every profile unless switched off | `components/profile/privacy-profile-section.tsx` | ON (picture: OFF, see 5) |
| Admin Panel tabs (F) | F | New | Match Library, Forms, Page Access, Sidebar, Achievements, Form Submissions, Entries, Sessions, Match Scout IDs, Practice Session IDs, Rescore, Audit Log, Backups, Setup Check; owner-only: Team Applications, Template Review, Recovery, Changelog, Credits | `ADMIN_TAB_IDS`, `TAB_LABELS` in admin/page.tsx | ON |
| Admin Panel tabs (T) | T | New | Match Library, Forms, Page Access, Sidebar, Achievements, Form Submissions, Sessions, Rescore, Audit Log, Backups; owner-only: Changelog, Credits | `ftc.ts` `admin.tabs` | ON |
| Form Submissions + season dropdown | F+T | New | Admins close new form submissions for all forms or one season; every form page has a season select | `submission-controls-panel.tsx` | ON |
| Join a team / Create a team screen | F+T | New | One setup screen at `/<program>/apply-to-team`; join with a code; Sign out from it | `components/auth/team-setup-card.tsx` | ON (create: see 5) |
| Team Management > join requests | T | New | Admin approves or denies a request to join | `data/ftc/join-requests.ts`, `joinRequests: true` | ON |
| Team Settings: team switcher | T | New | See 5 and 7: code exists, owner says memberships are not built | `components/team/account-teams-section.tsx`, `multiTeam: true` | CONFLICT |
| Import CSV (Analytics) | T | New | Admins/Lead Scouts import entries from a file | `components/analytics/import-csv-dialog.tsx` | ON (FRC old app already had CSV import: `analytics/page.tsx:1862`) |
| Admin Panel > Backups | F+T | New | Export-only backup of team data | `components/admin/backups-panel.tsx` | ON |

## 2. IMPROVED existing FRC features (only what the code or a commit subject shows)
| Label | Prog | Cat | One line | Proof | Status |
|---|---|---|---|---|---|
| Analytics tables | F | Improved | Pinned solid headers, text stays in its column, Session ID with copy | commit "solid pinned headers...", `components/analytics/` | ON |
| Event Select / Analytics event menu | F | Improved | Defaults to the season's newest event; All Events limited to the season; sorted by game | commits "default event by season", "Event Select sorted by game" | ON |
| Match List | F | Improved | Start times in your own time zone with the zone name; a finished event shows Completed | commits; old page used plain `toLocaleTimeString`, no "Completed" | ON |
| Lead Scout / Match Strategy / Drive Reflection | F | Improved | Robot team numbers fill from the chosen match | `lib/forms/team-fill.ts` | ON |
| Match Scout Form | F | Improved | Notes are one box beside the form on large screens; descriptions under counters removed | `components/forms/sticky-notes-panel.tsx` | ON |
| Dashboard | F | Improved | One Dashboard with a role switch replaces 11 separate role dashboard URLs | `config/legacy-redirects.ts` | ON |
| Performance Reliability / Robot Radar / Pick List | F | Improved | Now shared with FTC; any FRC behavior change: golden test says Radar output unchanged | `lib/analytics/robot-radar.golden.test.ts` | ON |
| Climb question | F | Improved | Optional "Attempted climb" answer feeds the Climb Reliability plot | REMAINING.md additive fields | ON |
| Admin Panel > Entries | F | Improved | Admins find and edit any entry of any form | `components/admin/entries-panel.tsx` | ON |

## 3. FIXED (only bugs proven in `live-before-v2`)
| Label | Prog | Cat | One line | Proof | Status |
|---|---|---|---|---|---|
| Assignments table | F | Fixed | Event column showed the raw key (e.g. `2026lake`); now shows the event name | old `assignments/page.tsx:3592,3623` print `assignment.eventKey`; new uses `useEventName` | ON |

Checked and NOT old bugs (do not list): Scout Accuracy / practice sessions not loading and total entries stuck at 0 (FIREBASE_FINDINGS.md compares old CS, which worked, with the rebuild); dropdown layout shift (old app has no Radix, plain `<select>`); live total on forms (old scout form showed none). Unproven: scroll position after navigation (see 7).

## 4. CHANGED behavior and REMOVED (old app vs this release)
| Label | Prog | Cat | One line | Proof | Status |
|---|---|---|---|---|---|
| URLs `/frc/...` | F | Improved | Every app URL starts with `/frc`; old links redirect | `config/legacy-redirects.ts`, `APP_SEGMENTS`, CLAUDE.md | ON |
| Form display names | F+T | Improved | Form pages say "REBUILT Match Scout Form"; the sidebar keeps "Match Scout Form" | `lib/forms/form-display-name.ts` | ON |
| Sidebar | F | Improved | Forms group by default; Credits and Team Settings links added; "Event Selection" is now "Active Events"; Admin Panel for admins | `lib/nav.ts`; old `Sidebar.tsx` | ON |
| Themes | F | Improved | Theme list replaced (old: CompSocrates Light/Dark, Atlantic, Emerald, Amber, Indigo, Forest, Copper, Deep Purple/Red, 14 pride). A saved old theme falls back to "Team Colors" | `lib/themes.ts` (comment line 6, `getTheme`) | ON |
| Theme on sign-out | F+T | Improved | Sign-out resets the screen to default; returns on sign-in | `components/theme/theme-provider.tsx` | ON |
| Privacy choices | F | Changed | Old Account offered Team / Public / Private; new offers "Public to my team" / "Private" | old `account/page.tsx:419-423` | ON |
| Removed: Account > Change Email | F | Removed | Email is read-only (old had Change Email) | new `account/page.tsx:160`; old h2 "Change Email" | ON |
| Removed: Account > Danger Zone (Delete account) | F | Removed | No delete button (route exists, not wired) | REMAINING.md; old `account/page.tsx:259` | ON (absent) |
| Removed: Account > Team Membership (Leave Team) | F | Removed | No Leave Team button | grep: none in HEAD | ON (absent) |
| Removed: Account > Cookie Preferences, cookie banner | F | Removed | Not in new account page; banner not audited | REMAINING.md; grep "Cookie" in `home-redirect.tsx` only | ON (absent) |
| Removed: Admin > Default Dashboard, Simulated Date/Time, Owner User Management | F | Removed | Old Admin Panel cards; no equivalent found | grep in HEAD: 0 hits | ON (absent) |
| Removed: `/form-builder` | F | Moved | Form Builder is Admin Panel > Forms | redirect `/form-builder` to `/admin` | ON |
| Removed: `/version-releases`, `/update-lot` | F | Moved | Go to Changelog; free-text `versionReleases` notes are NOT imported | redirects; REMAINING.md | ON |
| Removed: `/settings/api-keys` ("The Blue Alliance API Key") | F | Removed | Old page where a team set its own TBA key is gone; URL redirects to Team Settings, which has no key field (no "API key" UI in HEAD app/components; D19) | redirect row; old `TBAKeySettings.tsx:134` | ON (absent) |
| Moved: admin ID tools | F | Moved | `/admin/match-scout-ids`, `/admin/practice-session-ids` are tabs; old URLs land on plain `/admin` | redirects; REMAINING.md | ON |
| Renamed routes | F | Moved | `/event-selection` to `/event`; `/event-details/:key` to `/events/:key`; `/scout-form` to `/scout` (`?lead=1` to `/lead-scout-form`); `/strategy-scout-form` to `/team-strategy-form`; `/drive-scout-form` to `/drive-reflection-form`; `/analytics/lead` to `/lead-scout`; `/analytics/pit` to `/pit-scout`; `/profile/:id` to `/people/:id`; `/pick-list` to `/analytics/pick-list`; 11 role dashboards to `/dashboard?role=` | `config/legacy-redirects.ts` | ON |
| New team / application screens | F | Improved | Setup screen has Join a team first | `team-setup-card.tsx` | ON |

## 5. BUILT BUT OFF OR NOT IN THIS RELEASE (do NOT announce)
- Profile picture upload: OFF until `appSettings/global.avatarUploadsEnabled` is true (missing = OFF). The OLD app had picture upload, so existing users lose it until the owner turns it on. Proof `lib/avatar/settings.ts`, SESSION_I_RESULTS.
- Creating a team: `teamCreationEnabled` missing = OFF. FRC still shows "Apply to create a team" (an application, owner approves; `creationMode` returns "apply" when the program has applications). FTC shows "Applications to create a team aren't open yet". Owner said "closed": FRC is not closed in code.
- Multi-team accounts / team switcher / "Team Settings" account teams: code exists for FTC (`multiTeam: true`); owner says not built. Do not mention (see 7).
- Sub-in requests, Team Applications, Team Communication in FTC: feature flags off in `ftc.ts`. Match Prediction and Judge Book in FTC: hidden.
- "Delete my account": route exists, no button. Restore from backup: not built. Leave a team: not built.
- Per-role sidebar layouts, sidebar Sync between programs (exists, needs admin rights in both programs; not a headline).
- Legacy changelog import (`scripts/import-cs-changelog.ts`): not run; old notes live only in Firestore.

## 6. NOT TO MENTION (topics only)
Firestore rules and rule tests; API-route hardening; unit/e2e tests and the test suite status; security audit and dependency upgrades; admin credentials and keys; export, migration and attendance-audit scripts; brand and parity guard tests; refactors (shared components, program ports); the old app's open rules and security notes; the `preview` / `CompSocrates-v2` branches.

## 7. OPEN QUESTIONS
- Template item 8 (several teams per account, switcher): `multiTeam: true` and `account-teams-section.tsx` exist, but you say memberships are not built. REMAINING.md line 111 says "not built: adding teams" while CLAUDE.md (Batch 5a) says it is built. Unproven in a browser. Recommend dropping this item.
- Template items 3, 4, 6, 7 are tagged for BOTH programs as "new": Live/Lobby practice, Scout Accuracy, Robot Radar, Pick List already existed for FRC in the old app (Live/Lobby/Accuracy/Radar/Pick List all in `live-before-v2`). For FRC they are not new; edit the tags to FTC only or reword.
- Template item 5 (CSV import) is tagged both; old app already let coaches import CSV (`analytics/page.tsx:1862`). FTC only.
- Template proofs: items 1 to 10 proof files all exist (checked). Item 1 sidebar and 2 Page Access: true, both programs. Item 9 Changelog "improved": true. Item 10 Credits: true, footer link exists (`site-footer.tsx:35`), shown on public pages and in the app shell.
- Credits page default (no saved credits) shows placeholders "Team member name" x3 and "Built with AI / Claude" and a tech list (`lib/credits/seed.ts`, `readCredits` returns null so the default shows). The owner must edit Admin Panel > Credits before release.
- Scroll to top after navigation: new code resets on path change; old app had no handler (`git grep scrollTo`: practice form only). Whether old users saw the bug is unproven.
- Bayou 2025 as its own event (alias `2025lake` removed): old app used that alias; whether old users saw it wrongly merged is unproven.
- Old app Public visibility: new account page shows only two options; I did not confirm "Public to everyone" is gone for existing profiles saved as `public`.
- Old match form vs new REBUILT form: layout differences (timers, notes box, shift fields) not compared field by field; "no live total" is NOT a change (old showed none).
- Old themes saved by users fall back to "Team Colors"; not run. `teamCreationEnabled`/`avatarUploadsEnabled` must be set by hand in `appSettings/global`.
- FRC rules still allow client team create and self-write of `users.teamId` (SESSION_I); not user-visible.
- Match Library in the old app: not found as an Admin tab; old `practiceMatches` data appears read-only (REMAINING.md). Unknown whether to call the tab new.
- GO_LIVE_CHECKLIST says NO-GO until owner tasks done (Firestore backup, rules, flags, keys, Blob store, smoke test).

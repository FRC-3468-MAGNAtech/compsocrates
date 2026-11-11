# Route map and decision log

Every old CompSocrates (CS) URL and where it goes in this app, plus the decisions that shaped the rebuild. The redirect table is data (`config/legacy-redirects.ts`), so renaming a URL means editing one row.

History: the route map was written before the pages were built and adopted without a separate approval pause, because the work was set to keep running. Everything in it is reversible.

## Principles
1. **Flat, predictable URLs.** CS-only pages get a plain name under an existing section (`/analytics/*`, `/events/*`). No `-form-reefscape` or `-placeholder` variants.
2. **Event context is handled once.** The active events come from one provider (`ActiveEventsProvider`, fed by a single team-doc subscription). No page re-resolves the event, re-reads the team doc or calls the TBA match endpoint on its own. Event details live at `/events/[eventKey]` (plural, so the open page is not caught by the restricted `/event` page). Pages that need a specific event take `?event=<key>`.
3. **One shell.** Every signed-in page lives under `app/(app)/layout.tsx`, so no page imports `Sidebar` or wraps itself in `ProtectedRoute`. Access is a `page-access` registry entry.
4. **Every old CS URL redirects.** Redirects are permanent (308) and generated from one table. A unit test lists every CS route and fails if one has no target.
5. **Role dashboards** collapse to `/dashboard` plus a `?role=` query. The nine old routes redirect to it.

## Route map

Redirect type: **=** same URL (kept), **→** redirect to the new URL.

### Public and auth
| CS route | New route | Notes |
|---|---|---|
| `/` | `/` = | Landing page, branded from `config/brand.ts` |
| `/login` | `/login` = | |
| `/signup` | `/signup` = | Create a team (the join code becomes the team doc id) or request to join; a team admin approves. See D6. |
| `/verify-email` | `/dashboard` → | A verify banner replaces the page |
| `/privacy-policy`, `/terms-of-service` | same = | Static pages in the `(marketing)` group |

### Dashboards
| CS route | New route | Notes |
|---|---|---|
| `/dashboard` | `/dashboard` = | Role-keyed widget dashboard. The no-team join flow moves to `/finish-setup`. |
| `/match-scout-dashboard`, `/scout-dashboard` | `/dashboard?role=match-scout` → | |
| `/pit-scout-dashboard` | `/dashboard?role=pit-scout` → | |
| `/pit-team-dashboard` | `/dashboard?role=pit-team` → | |
| `/drive-team-dashboard` | `/dashboard?role=drive-team` → | |
| `/lead-scout-dashboard` | `/dashboard?role=lead-scout` → | |
| `/lead-strategist-dashboard` | `/dashboard?role=lead-strategist` → | |
| `/coach-dashboard`, `/team-coach-dashboard` | `/dashboard?role=team-coach` → | |
| `/media-dashboard` | `/dashboard?role=media` → | |
| `/judge-awards-dashboard` | `/dashboard?role=judge-awards` → | |
| `/dashboard-selector` | `/dashboard` → | The role switcher replaces it |

### Events and matches
| CS route | New route | Notes |
|---|---|---|
| `/event-selection` | `/event` → | |
| `/event-details` | `/event` → | |
| `/event-details/[eventKey]` | `/events/[eventKey]` → | CS-only page: teams, schedule, rankings for one event |
| `/match-list` | `/match-list` = | |

### Forms
| CS route | New route | Notes |
|---|---|---|
| `/scout-form` | `/scout` → | |
| `/scout-form?lead=1` | `/lead-scout-form` → | matched with a `has` query condition |
| `/scout-form-reefscape`, `/scout-form-placeholder` | `/scout` → | All three games are scouted through `/scout` (D16). |
| `/pit-scout-form`, `/pit-scout-form-reefscape`, `/pit-scout-form-placeholder` | `/pit-scout-form` → / = | |
| `/strategy-scout-form` | `/team-strategy-form` → | |
| `/match-strategy-form` | `/match-strategy-form` = | |
| `/drive-scout-form` | `/drive-reflection-form` → | |
| `/helper-form` | `/helper-form` = | |
| `/form-builder` | `/admin` → | The form builder lives in the Admin Panel (forms tab) |

### Practice and accuracy
| CS route | New route |
|---|---|
| `/practice-scouting` | `/practice-scouting` = |
| `/scout-accuracy` | `/scout-accuracy` = |

### Analytics
| CS route | New route | Notes |
|---|---|---|
| `/analytics` | `/analytics/match-scout` → | |
| `/analytics/lead` | `/analytics/lead-scout` → | |
| `/analytics/pit` | `/analytics/pit-scout` → | |
| `/analytics/team-strategy`, `/match-strategy`, `/drive-reflection`, `/helper` | same = | |
| `/analytics/team-averages`, `/match-breakdown`, `/rankings`, `/team-breakdown`, `/pick-list`, `/scout-status` | same = | |
| `/analytics/team-breakdown/[teamNumber]` | `/analytics/teams/[teamNumber]` → | |
| `/analytics/match-prediction`, `/performance-reliability`, `/robot-radar`, `/accuracy-compare`, `/accuracy-verification` | same = | CS-only pages, rebuilt |
| `/pick-list` | `/analytics/pick-list` → | |

### Team, people, admin
| CS route | New route | Notes |
|---|---|---|
| `/assignments` | `/assignments` = | |
| `/team-management` | `/team-management` = | |
| `/people` | `/people` = | |
| `/profile/[userId]` | `/people/[userId]` → | |
| `/profile-[userId]` | none | The old route was unreachable (its folder name is not a dynamic segment), so nobody can have linked to it. No redirect. |
| `/account` | `/account` = | |
| `/admin`, `/admin/match-scout-ids`, `/admin/practice-session-ids` | `/admin` → / = | The two ID tools are Admin Panel tabs |
| `/settings/api-keys` | `/team-settings` → | There is no per-team API key any more (one server key, D4); the page holds the team's name, number and ownership. |
| `/judge-book`, `/judge-book/[cardId]` | same = | CS-only pages, rebuilt |
| `/version-releases`, `/changelog`, `/update-lot` | `/changelog` → / = | |

### Routes with no CS counterpart
`/apply`, `/finish-setup`, `/my-scouting`, `/credits`, `/team-settings`, the `/admin` panels, and the PWA and API routes. The Playwright fixture pages under `app/e2e/` are routes only when `E2E_THEME_CHECK=1`, so a normal build ships none of them.

## Decisions

Ids are stable: code comments cite them. A decision that was later replaced stays in the table and says so.

| # | Decision | Reason |
|---|---|---|
| D1 | **Adapter over CS's Firestore schema.** The app reads and writes CS's collections through typed converters (`data/cs/*`). Its own domain types (`ScoutEntry`, `FormEntry`, `TeamDoc`, `UserDoc`) stay the in-app model, so pages never see raw documents. | The schema must not change, and the CS app may run against the same data. |
| D2 | **Emulator only; no real Firebase project is touched.** Development and tests use the Firestore emulator (project `demo-compsocrates-rebuild` in `.firebaserc`) and the CS rules in `docs/cs-firestore.rules`. A real project is wired only through env vars, later. | Nobody could confirm which project is production, and production must not be touched. |
| D3 | **All three games stay supported** (REBUILT, REEFSCAPE, CHARGED UP) as game plugins behind one registry. The first pass made only REBUILT submittable, as in CS; D16 supersedes that. | The team needs the old games' data and analytics. |
| D4 | **All three data APIs stay.** TBA, the FIRST FRC API and Statbotics sit behind one event-provider interface (`lib/frc`, chosen by `lib/events` from `config/event.ts`). One server TBA key replaces CS's per-team keys. | They are different APIs today. If TBA folds into the FRC API, one adapter gets deleted. |
| D5 | **Superseded: the second event provider was removed.** The first pass kept a second provider selectable from config; it was later removed along with its season data, so the app is FRC-only. Everything removed (that provider, the multi-team model of D13 and the other game's forms) is recoverable from the git tag `pre-ce-removal`, for a later merge with the sister app. | Keeping dead code paths made env and API failures hard to read, and the merge can start from a clean tag. |
| D6 | **Permission model.** `isAdmin` for team admins, `isOwner` for the team owner and `isPlatformOwner` for the platform owner, plus a page-access registry. CS's `isTeamAdmin` and the legacy `role == "coach"` both map to `isAdmin` (`isAdminFromCsUser`). The platform owner comes from `RELEASE_OWNER_UIDS` / `RELEASE_OWNER_EMAILS` (D18). Event selection is admin-only, which changes behavior for non-admin members of CS teams. Signup either creates a team or files a join request that a team admin approves. | The page-access registry gives admins per-page control that CS's flat roles lack. |
| D7 | **Sub-in requests get their own collection** (`subInRequests`). They stop living inside `scouting`. A reader still filters legacy `entryType` rows out of `scouting`. | Mixed row kinds were a real source of bugs. This is the one place the schema gains a collection, and it is additive. |
| D8 | **The shared per-shift human-player value is fixed:** one counter per shift in the form, stored per shift (`teleop.humanPlayerFuelByShift`), with `teleop.humanPlayerFuel` the sum of the counted segments. Old docs, which hold a single total, still score the same. | CS's single shared counter was a bug. |
| D9 | **Theme:** a "CompSocrates" theme (CS's red) is added, and a CS account whose stored theme the app does not know gets it (`CS_DEFAULT_THEME_ID` in `config/cs.ts`). The other themes stay available. | CS accounts keep their look. |
| D10 | **Unknown CS fields pass through.** Writers use `merge` and never drop fields they don't know (for example `encryptedUserData`, `priorityTeams*`). | The existing data must survive every write. |
| D11 | **Playoff numbering:** bracket matches 1 to 13, finals 14 to 16, the mapping CS already uses. | Keeps `qf/sf/f` ids and the app's single `Playoff` type interoperable. |
| D12 | **Event codes are TBA keys** (`2026arli`). FRC practice schedules come from the FIRST API with the year stripped. Old aliases (`2025lake` to `2026lake`) live in `config/event.ts`. | Matches stored data. |
| D13 | **One team per account, behind one seam.** A team document holds one team. `useOurTeam()` (`lib/our-team.ts`) reads the team doc's `teamName` and `teamNumber` and is the single place a later multi-team switcher would plug in (`useIsOurTeam()`, `OurTeamProvider`). Leftover multi-team fields on user and team docs are left untouched: never read, never deleted. | CS has one team per team doc. A merge with the sister app, whose accounts hold several teams, can plug in at the seam; the tagged snapshot from D5 keeps the old implementation. |
| D14 | **Event names come from a chain, never a bare key.** API name (one season-wide TBA request per year, cached; failures never cached and retried), then a name stored in the team's own data (the additive team-doc field `selectedEventNames`, `eventName` on library and practice rows), then the static table `config/event-names.ts` (names CS's own code states), then the raw key as the last resort. `lib/events/names.ts` is the pure resolver; `<EventName>` and `useEventName(s)` are what the UI uses. | Events showed as `2026lake` when the lookup failed silently (no Admin credentials or no TBA key). The failure is now visible and the fallback is a real name. |
| D15 | **Brand config.** `config/brand.ts` is the only place that names the product: name, title, tagline, descriptions, domain, email sender, browser-storage prefix, export marker, file prefix, theme color and logo slots. Renaming the product, or merging with the sister app, is a change to that file. | User-visible strings and storage keys were spread across the code. |
| D16 | **Games are config entries and all three are submittable.** Each game is a `GameDefinition` in `config/games/`. Point-table games (REEFSCAPE, CHARGED UP) get their plugin and form generated from the entry; REBUILT keeps a hand-written plugin for its fuel formulas. REBUILT, REEFSCAPE and CHARGED UP can all be scouted from the match form, practice scouting and the admin editor, and analytics filters by game. Scoring is golden-tested against CS's own functions. | A new game is one config entry; CS's disabled submit paths were a limitation, not a feature. |
| D17 | **Favicon-only logo.** The only logo artwork is the browser-tab icon (`app/favicon.ico`, CS's own file, byte for byte; a test pins its hash). Navigation, login and loading screens show the text name, and the web app manifest lists no icons until official artwork exists. Every logo slot (mark, dark mark, Apple icon, 192px and 512px PWA icons, maskable icon, social image) is a field in `config/brand.ts` that is `null` until a file is supplied. | There is no official artwork yet, and nothing should ship a placeholder that looks official. |
| D18 | **One env module, CS variable names.** Server code reads environment variables through `lib/server/env.ts` (`ENV_VARS` is the list, checked against `.env.example` by a test). Names follow CS's own `.env.example` where the meaning is the same: `NEXT_PUBLIC_FIREBASE_*`, `NEXT_PUBLIC_TBA_API_KEY` (read on the server only), `FIRST_API_USERNAME`, `FIRST_API_TOKEN`, and the owner variables `RELEASE_OWNER_UIDS` / `RELEASE_OWNER_EMAILS`. The Firebase Admin trio is required on top. The old `ADMIN_EMAILS` auto-grant is removed: admin rights come only from the user document's admin flag and the owner variables. A missing or wrong key is reported with a named error code and never cached. | One place to find, check and explain every setting. See `docs/ENVIRONMENT.md`. |
| D19 | **Not carried over: `MIGRATION_EMAIL`, `MIGRATION_PASSWORD` and `TBA_KEY_ENCRYPTION_SECRET`.** Server routes act as the signed-in caller through the Admin SDK instead of one shared migration login, and the single server TBA key replaces per-team encrypted keys. The old encrypt routes are not ported. Setting these variables does nothing. | The shared credential and the open encrypt routes were weaknesses (`docs/SECURITY-NOTES.md`, local only). |

## Redirect implementation
- `config/legacy-redirects.ts` holds the table. `next.config.ts` turns it into `redirects()` (permanent, with `has` for the `?lead=1` case).
- `config/legacy-redirects.test.ts` asserts that every route in the CS route inventory (71 `page.tsx` files, counted from the CS copy) appears in the table or is kept as is, that no target is itself redirected, and that every target page exists.

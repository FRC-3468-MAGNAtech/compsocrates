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
| D20 | **Two programs, one site: `/:program` routes, program-namespaced data.** The signed-in app lives at `/frc/...` and `/ftc/...`; old CS URLs and unprefixed app URLs redirect to `/frc/...`. FRC data stays at the root, FTC data is `programs/ftc/...` in the same Firebase project, one Auth account across both. One product name (CompSocrates). FTC multi-team accounts go through `lib/our-team.ts`; FRC stays one team per account. FRC-only pages are greyed out for FTC. | The owner approved merging the sister app without touching FRC data or URLs. D5 (second provider removed) and D13 are superseded for FTC only. See docs/MERGE_PLAN.md. |
| D21 | **A program's games are config entries in that program's own registry.** The FTC game is `config/games/ftc/` (point-table entry, flat value keys exactly as the sister app stored them), built by `lib/ftc/games.ts` with the generic generators; it is not in `GAME_ID_LIST` / `GAME_DEFINITIONS`, so the default program's pickers, built-in forms, templates and document matching cannot see it. Its form is scored by the fields' own rules, not a `game:<id>` custom scorer (that resolves through the default registry only). `PointTableGameDefinition`, `GamePlugin` and `createPointTablePlugin` take an optional id type. | A shared closed `GameId` union would put one program's game name in the other's code and lists (the brand guard forbids it). Golden-tested against the sister app's frozen scoring in `lib/ftc/oracle/`. |
| D22 | **Shared pages become program-aware through a data port, one page at a time.** `useProgramData()` (`lib/program/data.ts`) returns a namespaced program's port (profile, team doc, scout entries, form entries, forms, games) or null for the root program, whose hooks are untouched; non-hook writers take an optional trailing `program`. `ProgramConfig.connection` lists the connected paths and the data features the program has: the shell mounts for FTC (`pagesConnected` true) but any other path shows `UnconnectedPage`, and a feature that is off does not mount or read. Several teams per account (`multiTeam`, FTC only) live in `lib/our-team.ts`: `accountTeams` on the team doc, a per-browser pick, `assignedTeamIds` per member, a switcher shown only when the program allows it. | Connecting page by page keeps the root program exactly as it was and never lets a shared page read the other program's collections (the rules refuse it, and showing the wrong data is worse). Scout page first. |
| D23 | **Form names are built, never stored: `<GAME> <Form Type> Form`, and new submissions pass one gate.** `lib/forms/form-display-name.ts` (`formDisplayName`, `displayNameOfForm`) builds the display name from the game label and the form type's label; stored ids, names and documents are untouched, and a custom form keeps its own name. Form pages choose a season (`?game=`, `lib/forms/form-season.ts`). A team's `formSubmissionSettings` (master and per season) is enforced in the two writers of a new entry (`saveEntry`, `saveFormEntry`) through `lib/forms/submission-guard.ts`; edits are never gated; client-side only until the rules are tightened. |
| D24 | **The sidebar is arranged by data, resolved in one place.** `lib/nav.ts` still says which pages exist (each now has a stable `id`); a per-team, per-program doc `settings/sidebar` only arranges them (order, groups one level deep, label and icon overrides, hidden). `resolveSidebar` (`lib/sidebar/resolve.ts`) is the only reader: it normalizes the config (a page the code has but the config lacks is appended, an unknown entry is ignored), applies the same page-access and admin checks as the route guard AFTER the config, drops empty groups, and falls back to the default layout if the config would lock an admin out of the Admin Panel or leave nothing to show. No config means today's layout with every form page in a "Forms" group. Sidebar visibility is cosmetic, never security. The Admin Panel builder is drag and drop (never arrow buttons), and the sidebar shows each page's own label, never the game-prefixed form name of D23. | Other teams want other layouts and the forms crowded the list. Keeping the code list as the truth means a new page can never vanish, and gating after the config means a config can never grant access. |
| D25 | **Solo practice for a program with its own session store.** `ProgramData.practice` is the port (`data/ftc/practice.ts`): team-wide `teamId ==` reads, the sister app's native session doc, flags on the session, no member-matching extras, no collection-group reads. Live and lobby are separate feature flags (`live`, `lobby`) and their entry points, hooks and watcher do not mount where off. Practice stays exempt from the submission switches in both programs (Session E); a session scouts with the built-in form when a saved override has no alliance-role block (`formWithRoles`). An alliance with no official score has no accuracy (null, never 0); the difficulty cut-offs come from the program's own game config (`ProgramConfig.gameDifficulty`). | `docs/BATCH3_RESULTS.md` |
| D26 | **Accuracy in a program whose entries only an admin may update.** Scout Accuracy reads team-wide through the port (`teamId ==`, never by event), counts entries from the entries, skips excluded, live and accuracy-less sessions (a null is never a 0) and shows an admin-only "Unassigned" row. Derived accuracy fields are written only by an admin (`lib/analytics/recompute-policy.ts`): a scout's save skips the recompute, an admin's save, an import or the Recalculate Accuracy button covers it; a failed recompute after a save is retried quietly and never reaches the scout. No rule was loosened. CSV import goes through `scoutEntries.importBatch` (stable ids, batches of 400, `importedFrom: "csv"`). | Resolves the audit's admin-only `scoutEntries` update problem without a field-scoped rule (option 2 of Batch 4). |
| D27 | **Team Settings and the Changelog for a program with several teams per account.** The page is shared: a program with `multiTeam` edits its account's teams list (add, rename, remove, who sees which) instead of the single name and number, and `ProgramConfig.teamSettings` says whether the Ownership card (a root-only server route) and the "form for each season" card (no Forms admin tab there) are shown. Every change is one batch with its audit entry through the port (`saveAccountTeams`, `setActiveForm`); a team a member is still assigned to cannot be removed (the rules would allow it; the app refuses). `activeForms` stays a season-to-form map, separate from the submission switches. The changelog store takes the program; each program has its own starter drafts (`ProgramConfig.changelogSeed`), created as drafts so nobody gets an unread badge. | Batch 5a |
| D28 | **Admin Forms, Sessions, Rescore and Backups for a program with its own data port; the active form is chosen in Admin > Forms.** The panels are shared; the form store, the templates service, the rescore writers and the backup export take the program (default: the default program, whose paths and behaviour are unchanged). FTC lists the four tabs in `ProgramConfig.admin.tabs`; there is NO separate Templates tab id: the team's templates are a view inside Forms (as in the other program), and `admin.templateSharing` (off for FTC) hides public templates, publish requests and review. Templates are applied through `/api/ftc/templates` (program REQUIRED in the body, Admin SDK, admin or owner of the team, own templates only). The active match form is chosen ONLY in Forms (`Set as active`, stored as `teams.activeForms.{season}`, unchanged), so Batch 5a's Team Settings card and its `teamSettings.activeForms` flag are removed. A form without the BIOBUZZ Hive/Garden block is never used for scouting (the built-in is), and Forms refuses to make it active. Backups are export only for both programs (restore is not ported: the other program has none, and a bulk restore under `programs/ftc/` would need a broad rule). A rescore skips (and counts) anything with no official score and never replaces a recorded accuracy with a missing one in a program with its own store. FTC rule fix: an admin reads only THEIR team's `auditLog`. | docs/BATCH5B_RESULTS.md |
| D29 | **Page Access lists every page; open pages stay customizable; All Members matrix (Session 6).** One Page Access tab for both programs: the pages come from `accessPageGroups(program, sidebarEntries)` (`lib/page-access/page-list.ts`: the access registry in sidebar group order, minus the program's `unavailablePaths`), the roles are the shared `ROLES`. An OPEN page starts ticked for every role and an admin can close it for a role (`openRestrictions`, additive; a client-side control, rules never gated open pages). The Dashboard and the personal pages (`ALWAYS_ON_PAGES`) can never be closed; admins and the owner bypass everything. The All Members matrix saves per click like the member view; cells come from `cellState` over `explainAccess`. `docs/SESSION6_RESULTS.md`. |
| D30 | **ONE platform changelog and ONE set of Credits, owner-edited, served by server routes (Session 7).** `platformChangelog/{id}` (entries tagged `programs`, items with an optional override) and `platformCredits/main` (sections and entries, a `version`) are written and read ONLY through Admin SDK routes (`/api/platform/changelog`, `/api/platform/credits`, public `/api/public/credits`); no client rule, the catch-all keeps them closed. The platform owner is checked live on every write (`isPlatformOwnerToken`); an edit carries the `rev` / `version` it started from and a stale one is a 409, never an overwrite. Program tags are DATA: pages and components never compare a program id. Per-team changelog authoring, its seeding and the per-team credits editor are gone (their documents are left in place, unread). `/credits` is a public page (removed from the unprefixed-app redirect list); `/<program>/credits` is the same component. Spec: `docs/SESSION7_RESULTS.md`. | Session 7 |
| D31 | **Snapshot routes: one shared, cached server read of read-mostly team datasets (read reduction 2a).** The free plan's reads are billed per device, and a client cache cannot help the second device; a server route reads a dataset once per TTL and serves every authorized member. Authorized by the Bearer token plus a fresh read of the caller's user document (the active-team pointer, never cached); the pointer is client-writable today, so this is EQUAL to the current exposure, not stricter. Freshness is manual (`builtAt` against a TTL the owner can set), chunks are cut by serialized size under the 2 MB cache-entry cap, Refresh is throttled to once per 2 minutes, every dataset is behind the master and its own flag, and any failure but the quota falls back to the direct read. Admin editing screens keep direct reads. `docs/READ_REDUCTION2A_RESULTS.md`. |

## Redirect implementation
- `config/legacy-redirects.ts` holds the table. `next.config.ts` turns it into `redirects()` (permanent, with `has` for the `?lead=1` case).
- `config/legacy-redirects.test.ts` asserts that every route in the CS route inventory (71 `page.tsx` files, counted from the CS copy) appears in the table or is kept as is, that no target is itself redirected, and that every target page exists.

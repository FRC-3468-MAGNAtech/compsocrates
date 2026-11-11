# Phase 1: Route map (CS old route to new route)

Status: **Adopted without a separate approval pause.** You asked me to keep running while you are away, so I treated that as waiving the Phase 1 gate. Everything here is reversible: the redirect table is data (`config/legacy-redirects.ts`), and renaming a URL means editing one row.

## Principles
1. **CE's route is the route.** Where a page exists in both apps, the CE URL wins and the CS URL redirects to it.
2. **Flat, predictable URLs.** CS-only pages get a CE-style name under an existing section (`/analytics/*`, `/event/*`). No `-form-reefscape` or `-placeholder` variants.
3. **Event context is handled once.** The active events come from one provider (`ActiveEventsProvider`, fed by a single team-doc subscription). No page re-resolves the event, re-reads the team doc or calls the TBA match endpoint on its own. Event details live at `/events/[eventKey]` (plural, so the open page is not caught by the restricted `/event` page). Pages that need a specific event take `?event=<key>`, as CE's `/scout` already does.
4. **One shell.** Every signed-in page lives under `app/(app)/layout.tsx`, so no page imports `Sidebar` or wraps itself in `ProtectedRoute`. Access is a `page-access` registry entry.
5. **Every old CS URL redirects.** Redirects are permanent (308) and are generated from one table. A unit test lists every CS route and fails if one has no target.
6. **Role dashboards** collapse to `/dashboard` plus a `?role=` query. The old nine routes redirect to it.

## Route map

Redirect type: **=** same URL (kept), **→** redirect to the new URL.

### Public and auth
| CS route | New route | Notes |
|---|---|---|
| `/` | `/` = | CE landing, CS branding |
| `/login` | `/login` = | |
| `/signup` | `/signup` = | CE flow (join code or apply), see decision D6 |
| `/verify-email` | `/dashboard` → | CE shows a verify banner instead of a page |
| `/privacy-policy`, `/terms-of-service` | same = | New static pages in the `(marketing)` group |

### Dashboards
| CS route | New route | Notes |
|---|---|---|
| `/dashboard` | `/dashboard` = | CE widget dashboard. The no-team join flow moves to `/finish-setup`. |
| `/match-scout-dashboard`, `/scout-dashboard` | `/dashboard?role=match-scout` → | |
| `/pit-scout-dashboard` | `/dashboard?role=pit-scout` → | |
| `/pit-team-dashboard` | `/dashboard?role=pit-team` → | |
| `/drive-team-dashboard` | `/dashboard?role=drive-team` → | |
| `/lead-scout-dashboard` | `/dashboard?role=lead-scout` → | |
| `/lead-strategist-dashboard` | `/dashboard?role=lead-strategist` → | |
| `/coach-dashboard`, `/team-coach-dashboard` | `/dashboard?role=team-coach` → | |
| `/media-dashboard` | `/dashboard?role=media` → | |
| `/judge-awards-dashboard` | `/dashboard?role=judge-awards` → | |
| `/dashboard-selector` | `/dashboard` → | CE has the role switcher |

### Events and matches
| CS route | New route | Notes |
|---|---|---|
| `/event-selection` | `/event` → | |
| `/event-details` | `/event` → | |
| `/event-details/[eventKey]` | `/events/[eventKey]` → | **New page** (CS-only): teams, schedule, rankings for one event |
| `/match-list` | `/match-list` = | |

### Forms
| CS route | New route | Notes |
|---|---|---|
| `/scout-form` | `/scout` → | |
| `/scout-form?lead=1` | `/lead-scout-form` → | matched with a `has` query condition |
| `/scout-form-reefscape`, `/scout-form-placeholder` | `/scout` → | Legacy game forms are not submittable (matches CS). Their data is read through the game plugins. |
| `/pit-scout-form`, `/pit-scout-form-reefscape`, `/pit-scout-form-placeholder` | `/pit-scout-form` → / = | |
| `/strategy-scout-form` | `/team-strategy-form` → | |
| `/match-strategy-form` | `/match-strategy-form` = | |
| `/drive-scout-form` | `/drive-reflection-form` → | |
| `/helper-form` | `/helper-form` = | |
| `/form-builder` | `/admin` → | CE's builder lives in the Admin Panel (forms tab) |

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
| `/analytics/match-prediction` | same = | **New page** (CS-only) |
| `/analytics/performance-reliability` | same = | **New page** (CS-only) |
| `/analytics/robot-radar` | same = | **New page** (CS-only) |
| `/analytics/accuracy-compare` | same = | **New page** (CS-only) |
| `/analytics/accuracy-verification` | same = | **New page** (CS-only) |
| `/pick-list` | `/analytics/pick-list` → | |

### Team, people, admin
| CS route | New route | Notes |
|---|---|---|
| `/assignments` | `/assignments` = | |
| `/team-management` | `/team-management` = | |
| `/people` | `/people` = | |
| `/profile/[userId]` | `/people/[userId]` → | |
| `/profile-[userId]` | `/people` → | The old route was unreachable. |
| `/account` | `/account` = | |
| `/admin`, `/admin/match-scout-ids`, `/admin/practice-session-ids` | `/admin` → / = | The two ID tools become admin panels |
| `/settings/api-keys` | `/team-settings` → | Per-team API key section lives there |
| `/judge-book`, `/judge-book/[cardId]` | same = | **New pages** (CS-only) |
| `/version-releases`, `/changelog`, `/update-lot` | `/changelog` → / = | |

### CE-only routes (kept as is)
`/apply`, `/finish-setup`, `/my-scouting`, `/credits`, `/team-settings`, the `/admin` panels, and the PWA and API routes.
- Kept even where they need FTC-free rewiring, because you plan to merge CE and CS later and want them as similar as possible.
- The 12 `app/e2e/*` fixture pages are excluded from production builds (they exist only for Playwright).

## Decisions behind the map
| # | Decision | Reason |
|---|---|---|
| D1 | **Adapter over CS's Firestore schema.** The rebuild reads and writes CS's collections through typed converters (`data/cs/*`). CE's domain types (`ScoutEntry`, `FormEntry`) stay as the in-app model, so CE's pages work unchanged on top. | You chose the adapter. The schema must not change. |
| D2 | **No real Firebase project is touched.** Development and tests use the Firestore emulator and the CS rules you provided. A real project is wired only through env vars, later. | I can't tell from "there is a CS firebase project" whether it is production, and the brief forbids touching production. |
| D3 | **All three games stay readable.** REBUILT, REEFSCAPE and CHARGED_UP are game plugins behind one registry. Only REBUILT is submittable, as in CS. | You need all the games. CS disabled the old submit paths, so enabling them would be a new feature. |
| D4 | **All three data APIs stay.** TBA, FIRST FRC API and Statbotics sit behind one event-provider interface. | They are different APIs today. If TBA folds into the FRC API, one adapter gets deleted. |
| D5 | **FTC code stays.** `lib/ftc/*` remains as a second provider, selected by `config/event.ts`. | You said to keep it. |
| D6 | **Permissions follow CE's model** (`isAdmin`, owner, page-access registry). CS's `isTeamAdmin` and `role == "coach"` map to `isAdmin`. Event selection becomes admin-only (CE behavior). | You chose the CE model. This is a behavior change for non-admin members of CS teams. |
| D7 | **Sub-in requests get their own collection.** They stop living inside `scouting`. A reader still filters legacy `entryType` rows out of `scouting`. | Mixed row kinds were a real source of bugs. This is the one place the schema gains a collection, and it is additive. |
| D8 | **The shared per-shift human-player value is fixed:** one counter per shift in the form, stored per shift, summed on read. Old docs, which hold a single total, still score the same. | You asked for the fix. |
| D9 | **Theme:** add a "CompSocrates" theme (CS's red) and keep every CE theme. | You chose it. |
| D10 | **Unknown CS fields pass through.** Writers use `merge` and never drop fields they don't know (for example `encryptedUserData`, `priorityTeams*`). | You said to keep all that data. |
| D11 | **Playoff numbering:** bracket matches 1 to 13, finals 14 to 16, the mapping CS already uses. | Keeps `qf/sf/f` ids and CE's single `Playoff` type interoperable. |
| D12 | **Event codes are TBA keys** (`2026arli`). FRC practice schedules come from the FIRST API with the year stripped. Old aliases (`2025lake` to `2026lake`) live in config. | Matches stored data. |
| D13 | **One team per team document.** CE's multi-team accounts and switcher are removed. `useOurTeam()` (`lib/our-team.ts`) reads the team doc's `teamName` and `teamNumber` and is the one seam a later multi-team switcher would plug into. Existing docs that carry field-team fields are left alone. | CS has one team per team doc. CE's FTC-specific account model has no meaning for FRC. |
| D14 | **Event names come from a chain, never a bare key.** API name (one season-wide TBA request per year, cached, failures never cached and retried), then a name stored in the team's own data (the additive team-doc field `selectedEventNames`, `eventName` on library and practice rows), then the static table `config/event-names.ts` (names CS's own code states), then the raw key as the last resort. `lib/events/names.ts` is the pure resolver; `<EventName>` and `useEventName(s)` are what the UI uses. | Events showed as `2026lake` when the lookup failed silently (no Firebase Admin credentials or no TBA key); the failure is now visible and the fallback is a real name. |

## Redirect implementation
- `config/legacy-redirects.ts` holds the table. `next.config.ts` turns it into `redirects()` (permanent, with `has` for the `?lead=1` case).
- `config/legacy-redirects.test.ts` asserts that every route in the CS route inventory (71 `page.tsx` files, counted from the CS copy) appears in the table or is kept as is, and that no target is itself redirected.

# Merge plan: CE (FTC) into the rebuild (FRC + FTC)
Status: Phase 2 implemented except the FTC data layer (see the end). Approved: one brand (CompSocrates, compsocrates.com), `/:program` routing, FTC games = the one built-in game, multi-team accounts for FTC only (FRC stays one team per account), Auth import for users, FRC-only pages greyed out in FTC.
Phase 1 plan follows. Source of FTC code: `CompEpicurus (reference)/lib/ftc`, also in git tag `pre-ce-removal`. CE's 36 pages are all in the rebuild already, so most FTC work is parametrizing, not porting.

## 1. Program layer
`config/programs/{frc,ftc}.ts` implement one `ProgramConfig`; `lib/program/` holds `ProgramProvider`, `useProgram()` and a server `programOf(req)`. Existing `config/brand.ts`/`event.ts` become the FRC entries; shared platform bits (storage prefix, domain) stay in a small `config/platform.ts`.
| Aspect | FRC | FTC (from CE) |
|---|---|---|
| Alliance / slots | 3 (`config/alliance.ts`), red1..3 | 2, red1..2: `allianceSlots(size)` must take the program |
| Season | calendar year (2026) | start year (2025 = 2025-26), `lib/ftc/config.ts getDefaultSeason` |
| Event id | TBA key `2026lake`, FIRST code = stripped; aliases, overrides | FTC event code (e.g. `USTXHOU`) + season; no aliases |
| Match id | TBA-key based (`data/cs/match-id.ts`) | `${eventCode}_${Q|P|F}${n}` (`lib/library/ids.ts`) |
| Team number | 1-5 digits | same regex, different lookup (`lib/server/first-team.ts`) |
| Playoff | 13 slots, finals offset 13 | CE `lib/ftc/bracket.ts` (verify slot map) |
| APIs | TBA, FIRST FRC, Statbotics (EPA) | FTC Events API only; no EPA, so EPA/prediction UI hidden |
| Games | `config/games/*` plugins (REBUILT, REEFSCAPE, CHARGED UP) | CE form-builder built-ins (`lib/forms/builtin*.ts`, BIOBUZZ) |
| Brand | `config/brand.ts` | per-program name, tagline, description, themeColor, logo slots (all `null` until art supplied, D17) |
Also program-aware: `lib/events/*` facade (provider chosen by program, not one global), `lib/active-event`, `lib/seasons`, manifest + metadata, emails (`emailSenderName`), export markers (`exportFormat`, `filePrefix` get a program suffix), localStorage keys (`${prefix}.${program}.x`), `lib/nav.ts`, form/analytics config, `legacy-redirects.ts`, API routes (`/api/live/*`, `/api/team/*`, cron).

## 2. Routing
Recommended: canonical `/:program/...` (`frc`|`ftc`), `app/(app)/[program]/...`, `dynamicParams=false`. Old URLs: `legacy-redirects.ts` destinations gain `/frc` (CS URL -> `/frc/<new>`); every unprefixed rebuild URL (`/scout`) 308s to `/frc/scout`. Links go through one `programHref(program, path)` helper; nav.ts and `<Link>` call sites are updated (a lint rule bans raw app paths).
Alternative (smaller diff, less explicit): FRC stays unprefixed, FTC lives at `/ftc/*` via a proxy rewrite. Rejected: the active program would be implicit for FRC and one missed link silently shows FRC.
Selector: home page (signed-out: two cards; signed-in: redirect to last-used program's `/dashboard`), dashboard header switcher, topbar chip. Not folded into team select: there is no team-select page (`components/forms/team-select.tsx` is a form picker); enrollment (create/join team) is per program, so it sits behind the selector. Last-used program: cookie `program` + `localStorage`, else the only program the user has a membership in, else the selector. `/api/*` takes the program from the path or a required body field, never from the cookie.

## 3. Firestore (CS project)
Namespace: `programs/ftc/{collection}/...` with CE's collection names (`teams, users, forms, formEntries, scoutEntries, practiceSessions, assignments, pickLists, libraryMatches, libraryEvents, lobbies, liveMatches, teamApplications, applicationBlocks, applicationPrivate, eventAttendance, auditLog, notifications, scoutTargets, formTemplates, profiles`). FRC paths do not move. Shared stays top-level: `appSettings, platformAuditLog, rateLimits, changelog, credits` (program-tagged by field where needed). `programs/ftc/users/{uid}` is the FTC membership profile (teamId, role, fieldTeams); the Auth uid is shared, root `users/{uid}` stays FRC-only.
Code: one module `lib/firebase/paths.ts` (`programCollection(db, program, name)`); FRC returns the root name unchanged, so FRC queries are untouched. FTC data code lives in `data/ftc/*` using CE's native schema (no CS adapter). Lint bans `collection(db, "<literal>")` in FTC code.
Rules (file written in Phase 2, `firestore.rules` additive, not deployed): CE's rules body goes inside `match /programs/ftc { ... }` with its helpers re-pointed at `/databases/$(database)/documents/programs/ftc/users/$(uid)` and `.../programs/ftc/teams/$(id)`. The FRC block is unchanged. Danger: CS's wildcard rules `{path=**}/scouts/{uid}` and `{path=**}/players/{uid}` also match FTC subpaths; Phase 2 either scopes them to FRC paths or proves the FTC use is safe (needs the emulator rules test, extended with a cross-program denial suite).
Indexes: CE's composite indexes are merged into `firestore.indexes.json` as-is. A COLLECTION-scope index is keyed by collection id, so it also serves `programs/ftc/<same id>` (correction to the first draft, which said COLLECTION_GROUP). FRC had none; the existing field overrides are untouched.

## 4. CE data migration (script only, never run by me)
`scripts/migrate-ce-to-ftc.ts`: reads CE via `CE_ADMIN_*`, writes CS via `CS_ADMIN_*`, **dry-run by default** (prints per-collection counts, id collisions, uid-map misses); `--apply` plus `--confirm-project=<CS id>` required; idempotent (`set` with the same ids, batch 400), stamps `migratedFrom: "ce"`. Maps CE root paths to `programs/ftc/<same>`; uid fields rewritten through the user map.
Users (different Auth projects), options: (a) same-email re-signup, claim by verified email: simple, but every doc keyed by CE uid needs rewriting at claim time and passwords are lost; (b) import CE Auth users into CS with Admin `importUsers` (`firebase auth:export` + CE hash params): keeps uid, password and Google links, zero doc rewriting; (c) manual. **Recommend (b)** for emails not in CS; for emails already in CS, the script builds a CE-uid -> CS-uid map and rewrites uid fields (a person with both accounts becomes one account). Needs from you: CE auth export and its hash key/params.

## 5. Page matrix
- Shared (parametrized): account, admin, analytics (rankings, team-averages, team-breakdown, team-strategy, match-breakdown, match-scout, match-strategy, pit-scout, drive-reflection, helper, lead-scout, scout-status, pick-list, teams/[n]), assignments, changelog, credits, dashboard, event, match-list, my-scouting, people(+[uid]), profile, scout-accuracy, all `*-form` pages, practice-scouting, team-management, team-settings, apply/signup/login/finish-setup.
- FRC-only (not in CE): analytics/accuracy-compare, accuracy-verification, match-prediction (EPA), performance-reliability, robot-radar, judge-book(+[cardId]), events/[eventKey]. Hidden for FTC.
- Diverged, **need your decision**: (1) scout form + scoring: CE form-builder vs rebuild `GameDefinition` plugins; (2) team model: CE has several FTC teams per account (`fieldTeams`), rebuild is one team per account (D13); (3) landing page and signup copy per program; (4) practice/live scoring (FTC live API); (5) analytics data context (CE `scoutEntries` vs CS `scouting` adapter); (6) whether performance-reliability and robot-radar get an FTC version.

## 6. Env vars (combined `.env.example`; `lib/server/env.ts` entries get a `program` label)
- shared: `NEXT_PUBLIC_FIREBASE_{API_KEY,AUTH_DOMAIN,PROJECT_ID,STORAGE_BUCKET,MESSAGING_SENDER_ID,APP_ID,VAPID_KEY}` (CS project), `FIREBASE_ADMIN_{PROJECT_ID,CLIENT_EMAIL,PRIVATE_KEY}`, `APP_URL`, `CRON_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `BLOB_READ_WRITE_TOKEN`, `APPLICATION_SECRET`, `RELEASE_OWNER_{UIDS,EMAILS}`, `NEXT_PUBLIC_RELEASE_OWNER_UIDS`.
- FRC: `NEXT_PUBLIC_TBA_API_KEY` (server secret despite name), `FIRST_API_USERNAME`, `FIRST_API_TOKEN`.
- FTC: `FTC_API_USERNAME`, `FTC_API_KEY`, optional `FTC_API_BASE_URL`. Missing keys disable FTC live data with a visible notice; FRC is unaffected.
- Dropped (CE only): CE's own `NEXT_PUBLIC_FIREBASE_*`, `OWNER_EMAILS` (use `RELEASE_OWNER_EMAILS`). Migration-script only (not in the app file): `CE_ADMIN_*`, `CS_ADMIN_*`.

## 7. Risks and questions
1. Brand: one product name over two programs, or per-program names (CompSocrates / CompEpicurus)? Which domain?
2. Approve `/:program` routing (touches every link) vs the smaller `/ftc` prefix alternative?
3. FTC games: only CE's built-ins, or also a new FTC game config? Form-builder vs `GameDefinition` for FTC (section 5.1)?
4. Multi-team accounts for FTC through `lib/our-team.ts`: approve? FRC stays one team.
5. Approve option (b) for users; can you supply the CE Auth export and hash params?
6. Cross-program team numbers: an FTC and an FRC team may share a number; they are separate docs by path, no merging.
7. Push notification tokens do not migrate; CE users must re-enable.
8. Unverified: FTC playoff bracket slot numbers, the wildcard-rule exposure above, and whether proxy/`dynamicParams` work with the existing session redirect in `app/(app)/layout.tsx`; each needs a spike or emulator test in Phase 2.

## Phase 2 status
Done: program layer, `/:program` routes + redirects, selector, program-aware Link/router, FTC provider + env vars, rules block + indexes + isolation tests, migration script, brand guard. Not done: wiring the shared pages to FTC data (the shell shows `ProgramGate` while `pagesConnected` is false). That needs an FTC data layer for the sister app's `scoutEntries`/`formEntries`/forms schema (vs the CS adapter), then flipping the flag. FTC multi-team accounts go through `lib/our-team.ts`.

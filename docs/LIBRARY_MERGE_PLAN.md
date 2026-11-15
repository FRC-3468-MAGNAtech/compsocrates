# Match Library merge: plan (Phase 1, no code changed)
Repo: `CompSocrates rebuild/`, branch `rebuild` (not main). Unrelated uncommitted change: `docs/BATCH5B_RESULTS.md` (I will not commit it).

## 1. Feature table (FRC = `match-library-panel` + `library/*`, FTC = `schedule-library-panel` + `schedule-*`)
| Feature | FRC | FTC |
|---|---|---|
| Layout | Panel with 2 tabs: "Imported (FIRST API)" (season Select, event code, Import, Refresh scores, one event's table) and "Manual events" (event dropdown, Add/Edit/Delete event) | Event LIST, click into an event page (back button) |
| Import | `importLibraryEvent` (client, root collections): PLAYED matches only, scores+difficulty, `published: true`, never overwrites manual | `port.importSchedule` (server fetch, typed key errors): scheduled matches, unscored allowed, `published: false` + `needsReview`, stable ids `${code}_${Q\|P\|F}${n}`, 400/batch, audit |
| Create event / edit event | Dialog (name, code, date, source URL, default video); Edit event | Small "New event" dialog (name, date, code); NO edit |
| Add/edit/duplicate match | `ManualMatchDialog` (scores REQUIRED, penalty, video, notes), Fast entry, Bulk import dialog (CSV/paste, needs-review) | own `MatchDialog` (teams + time, no scores, published at once), `ScheduleFastEntry`, `ScheduleBulkImport` |
| Official score | typed as the match score (required; difficulty computed) | separate "Score" dialog, optional per alliance, clear = "No official score yet" (`scoreKnown`) |
| Publish / unpublish | Manual tab only (bulk toolbar + "Publish all" for needs-review); imported rows have none | per match + all + toolbar, imported and manual |
| Delete | manual matches (confirm, bulk) and EMPTY manual event | manual matches and manual event WITH its matches |
| Video | per-row inline video + times (imported), bulk "Set video link", video CSV import, default video | none (practice uses timer placeholder) |
| Extras | Search + status filter, "Update library" backfill, placeholder-video switch | none |
| Error states | Imported/manual lists: a failed read looks EMPTY (root hooks swallow errors) | events and matches show error + Try again; unreadable-docs notice |
| Alliance size | `ALLIANCE_SIZE` constant (dialog grid, fast-entry columns, bulk columns) | `ProgramConfig.event.allianceSize` |
| Role gate | `/admin` page: `isAdmin` only (lead does not open it; same in both programs) | same |
Reads/writes: FRC root `libraryEvents`, `libraryMatches` (+ `auditLog` entries `edit-match-library`, `teams.usePlaceholderVideo`, backfill). FTC `programs/ftc/libraryEvents|libraryMatches` through `programPath`; reads are 2 equality queries (`origin == api`, `teamId == mine`). No collection-group queries.

## 2. Readers outside the panels (must not change)
`useLibraryMatches/Events/AllLibraryMatches/BySeason` (`lib/match-library.ts`, `lib/library/store.ts`) already pick the port via `useProgramData()`; consumers: `practice/match-select` (published only, port or root), Practice Scouting page, `assignments`, `analytics/match-breakdown`, `my-scouting`, profile, `rescore-panel` (calls `importLibraryEvent` for FRC, port import for FTC), `lib/analytics/data-context`, `lib/dashboard/data`, `lib/scout-stats`, `lib/scheduler/sources`, live/lobby flows, backups (`lib/admin/backup` root, `lib/ftc/backup`), CSV import. They take the program through the hooks and the port, not through the panel. CS `practiceMatches`: still merged read-only only when `!includeUnpublished && !portActive` (`useLibraryMatches`), never in admin tables. I keep every hook signature and add nothing they depend on.

## 3. Design
- ONE panel `components/admin/match-library-panel.tsx` (FRC layout: two tabs "Imported (<API name>)" and "Manual events"; FRC dialogs, `Select`, row heights). Delete the FTC list/drill-in.
- ONE data interface `LibraryAdapter` (`lib/library/adapter.ts`): `createEvent, updateEvent, deleteEvent, upsertMatches, setPublished, setScores, deleteMatches, setVideoLink, importEvent` (reads stay the existing hooks). `useLibraryAdapter()` returns `useProgramData().library` when there is a port, else `rootLibraryAdapter` (a thin wrapper over `lib/library/store.ts` + `importLibraryEvent`, byte-for-byte the same writes). This is the only reader of `useProgramData()` for the panel (not in `components/`). The FTC port gains `updateEvent` + `setVideoLink` (both allowed by current FTC rules; no rule change expected).
- Program config (`ProgramConfig.library`, additive): `scoresRequired` (FRC true, FTC false), `importKind` ("played" | "schedule"), `importLabel`, `importStartsDraft`, `backfill`, `videos`. Allowed differences only: score optional, schedule time shown only where matches carry one, 2 vs 3 slots (`allianceSlots`), API labels.
- Imported tab for both: same controls; the table gets the shared columns (Match, Origin, Red, Blue, Score, Video, Status, actions). Both programs get Status, Publish/Unpublish (single, bulk, "Publish all needing review"): FRC data already has `published`/`needsReview`; rules let admins update; no schema change. FRC imported rows stay published unless an admin unpublishes.
- Official score: ONE score section inside `ManualMatchDialog`, required for FRC (as today, difficulty recomputed), optional for FTC (blank = unknown, never 0), plus FTC's "Clear score". The separate Score dialog is deleted. Scoring an FRC imported match stays out (API scores are authoritative); FTC API matches keep the "set official score" action via the same dialog in score-only mode.
- Video: FTC gets FRC's video column, default video and "Set video link" (docs already allow an optional `video` map; `match-select` already reads it and keeps the timer when absent). FRC-only and hidden for FTC: "Update library" backfill (no pre-P15 FTC docs). Video CSV import and the placeholder switch: see decisions.
- Errors: shared panel shows error + Try again and the unreadable notice for both. The root hooks must return `error` (additive; they swallow it today).

## 4. Parity map and deletions
FRC supplies: panel layout, tabs, `ManualEventDialog`, `ManualMatchDialog`, `FastEntry`, `BulkImportDialog`, `Select`, delete confirm (`ConfirmDeleteDialog`), copy. FTC keeps: server import with typed key errors, stable ids, needs-review start, `scoreKnown`, audit via port.
Delete: `components/admin/schedule-library-panel.tsx`, `schedule-fast-entry.tsx`, `schedule-bulk-import.tsx`; from `lib/library/schedule.ts` the FTC-only raw/bulk validators that the shared dialogs replace (keep `buildManualMatchDoc`, scores, ids, import types and their tests); parity-guard entries for the two panels. `useProgramData()` reader list: drop `schedule-library-panel`, `match-library-panel` (reader moves to `lib/library/adapter.ts`, listed with a reason).

## 5. Safety net (nothing component-level or store-level exists for FRC today)
Exist: pure rules in `lib/library/library.test.ts` (validation, bulk parsing, ids, origin, optional times, difficulty) and `schedule.test.ts`; FTC port in `data/ftc/library.test.ts`. Missing, to write FIRST against current code: (a) store writes with mocked `firebase/firestore`: create/update/delete event, upsert (create and edit keep ids and fields, skip API id), delete, publish, video link, 400-batch split, audit entry; (b) `importLibraryEvent` with mocked fetch/actions (docs, ids, skips, never overwrites manual, second run); (c) root hook empty/loading; (d) panel render tests for FRC (tabs, empty text, loading, table, manual flow with fast entry/bulk/delete confirm, admin gate) with mocked store. They pin what is stored and shown today, including the "swallowed error" gap as a documented current behavior.

## 6. Alliance size
`ALLIANCE_SIZE` is read by: `manual-match-dialog.tsx` (grid), `fast-entry.tsx` (`teamFieldsFor()` at module load), `lib/library/bulk.ts`, `manual-match.ts` (defaults). Pure functions already accept a `size`; I pass `allianceSlots(program)` from config through dialog, fast entry and bulk, keep the constant as the default so FRC output is identical. `isValidAllianceTeams` in `importLibraryEvent` keeps the default. Left for Batch 6, untouched: live and lobby flows reading the fixed size.

## 7. Risks and decisions for you
1. FRC differs structurally from FTC (played scores vs schedule); the merge is by config flags, not by branching on program id.
2. FRC read errors: adding `error` to the root hooks is a (small) FRC change. OK? (Recommended yes.)
3. FTC gets video entry (Practice then plays the video instead of the timer for matches that have one). OK? (Recommended yes.)
4. FRC gets Publish/Unpublish on imported matches and a Status column. OK? (Recommended yes.)
5. "Lead" roles: library stays admin-only (as before). OK?
6. FTC placeholder-video switch and video CSV import: needs program-aware team write / import. Recommend hide for FTC now and list for later.
7. FTC "Delete event" removes its matches too; FRC requires an empty event. Recommend FRC rule (delete matches first) for both? It changes FTC behavior.
8. FRC import copy ("imported N, skipped M without posted scores") vs FTC "N new, M updated": shared sentence built from a common summary; FRC wording stays.

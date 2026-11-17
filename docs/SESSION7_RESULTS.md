# Session 7: one platform Changelog and one public Credits page (results)

Branch `rebuild`. No rule changed, nothing deployed, no production read or write, nothing run against a real project (emulator and mocks only).

## What changed
- **Data (additive, Admin SDK routes only, no client read or write, no rules):** `platformChangelog/{id}` = `{ title, version ("" if none), date, status draft|published, programs[], items[{category new|improved|fixed|removed, text, programs?}], legacy, createdBy, createdAt, updatedAt, publishedAt, rev }` (times are epoch ms). `platformCredits/main` = `{ sections[{id, title, description?, entries[{id, name, description, link|null, imageUrl|null}]}], version, updatedAt, updatedBy }`.
- **Routes:** `GET|POST /api/platform/changelog` (feed for any signed-in account, drafts only for the owner with `?drafts=1`; owner writes create/update/publish/unpublish/delete), `GET|POST /api/platform/credits` (owner read uncached, owner save or reset), `GET /api/public/credits` (public, cached 30 s). Owner = `isPlatformOwnerToken` live; 120 writes/hour/owner; platform audit entry in the same transaction; 409 `conflict` on a stale `rev`/`version`; 503 `server_not_configured`.
- **Changelog page:** one page, shared feed, current program + both-tagged items, "Show all programs" with FRC/FTC badges, categories, legacy below with a label. Unread dot = published, non-legacy, an item for this program, newer than `lastSeenChangelogAt` and the account's creation; mark-seen write unchanged. No team needed.
- **Owner editor:** Admin Panel > Changelog and > Credits, the same two tabs in BOTH programs (`platform-changelog`, `platform-credits` in `PLATFORM_TABS` and both tab lists). Item reorder by buttons or Alt+Arrow, preview "as FRC/FTC/all sees it", conflict message with "Load the latest version".
- **Credits:** `CreditsView` at public `/credits` and `/frc/credits`, `/ftc/credits`; built-in list (`lib/credits/seed.ts`, unchanged) until the owner saves. Links: marketing header and `SiteFooter` (footer test now expects two links). `credits` removed from `APP_SEGMENTS` (test updated) so `/credits` is not redirected to `/frc`.
- **Removed:** per-team changelog authoring, seeding, starter drafts (`lib/changelog/store.ts`, `seed.ts`, `lib/ftc/changelog-seed.ts`, the entry editor), per-team credits store and edit toggle. Brand guard: 3 narrow test-file allowlist entries (program ids as data); the guard stays strict.

## Old collections that now go unread (left in place, untouched)
`changelog`, `programs/ftc/changelog`, `credits`, `programs/ftc/credits`, and the `changelogSeeded` team flag.

## Run the tools yourself (nothing was run)
Set in YOUR shell (never in a file): `CS_ADMIN_PROJECT_ID`, `CS_ADMIN_CLIENT_EMAIL`, `CS_ADMIN_PRIVATE_KEY` (or `FIREBASE_ADMIN_*`).
1. Export (read-only, output must be outside the repo): `npx vite-node --config vitest.config.ts scripts/export-cs-changelog.ts --out="C:\Users\<you>\cs-release-notes.json"`. Reads `teams/*.versionReleases[]` and the root `versionReleases` collection (key `global`), keeps 5 fields only.
2. Dry run (no credentials): `npx vite-node --config vitest.config.ts scripts/import-cs-changelog.ts --input="C:\Users\<you>\cs-release-notes.json"`; read every line, then `... --apply --confirm-project=<project id>`. Create-only, batches of 400, ids `cs-legacy-{team}-{oldId}`, all tagged for the default program, `legacy: true`.

## v2.0.0 template (Task 6 done; fills the form, you press Save). Item - proof file
Both programs, tags computed from each program's config (test checks the files exist): sidebar arrangement - `components/admin/sidebar-panel.tsx`; Page Access - `components/page-access/page-access-panel.tsx`; Live and Lobby practice - `components/practice/lobby/lobby-flow.tsx`; Scout Accuracy - `app/(app)/[program]/scout-accuracy/page.tsx`; CSV import - `components/analytics/import-csv-dialog.tsx`; Robot Radar - `components/analytics/robot-radar-chart.tsx`; Pick List - `app/(app)/[program]/analytics/pick-list/page.tsx`; one Changelog for the site - `app/(app)/[program]/changelog/page.tsx`; public Credits - `app/(marketing)/credits/page.tsx`. One program only (multi-team): several teams per account - `components/team/account-teams-section.tsx`. Wording: `lib/platform-changelog/template.ts`.

## Verify
`npm run lint` 0 errors, 0 warnings. `npm test` 3851 pass, 3 fail, 300 files. Build passes. `test:rules` (emulator, rules unchanged) 423 pass, 0 fail. The 3 failures are the brand guard on files this session did not touch (`lib/scout-stats/my-scouting-filters*`, `lib/page-access/*.test.ts`, `components/page-access/matrices.test.tsx`, `lib/profile/events-attended.test.ts`, `scripts/audit-event-attendance.ts`): not fixed.

## Manual check (O = needs the owner account)
1. Signed out: open `/credits` from the landing header or footer.
2. Sign in, open `/frc/credits` and `/ftc/credits`: same content.
3. O: Admin Panel > Credits (in FRC and in FTC), edit one entry, Save, reload `/credits` (allow 30 s).
4. Open Changelog in FRC and FTC: only tagged items differ; "Show all programs" shows everything with badges.
5. O: Admin Panel > Changelog > New entry with one FRC-only and one FTC-only item, Publish.
6. Second account: the dot lights in the program that has an item for it, clears on opening.
7. Legacy entries below, labelled, no dot (needs the import to have run: it has not).
8. Team admin who is not the owner: no Changelog or Credits tab.
9. Account with no team: `/credits` works; Changelog data needs no team (its routing is a later session). Side by side: /frc and /ftc Changelog and Credits.

## Rollback and left for later
Rollback: revert the Session 7 commits; the new collections can stay (nothing reads them). Left: routing for no-team accounts inside the program shell; trimming the dead per-team helpers in `lib/changelog/index.ts`.

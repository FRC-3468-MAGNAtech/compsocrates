# Read reduction 2a: shared roster, flag dedupe, snapshot routes (roster and library): results

Branch `release-prep`. Nothing deployed, no real project touched, no rules or index change. Entries, sessions, flags, the Analytics one-time read and the legacy filter are phase 2b (separate go-ahead after the preview test below).

## What shipped (each its own commit)
1. Tests first: characterization of the roster, library and practice-exclusion outputs; harness pages for roster and library.
2. ONE roster listener per (program, team) for every `useTeamMembers` call site (20 s linger); ONE `scoutingFlagStates` listener shared by the entries feed and `lib/practice-extras.ts`.
3. `GET /api/snapshot/<dataset>?program=&chunk=&refresh=` for `roster` and `library`: token check, fresh read of the caller's user document on every request (active team, never cached), `unstable_cache` with manual TTL freshness, size-based chunks (about 1.2 MB, under the 2 MB cache entry cap, over-cap reported not silent), Refresh once per 2 min per team and dataset, per-dataset flags, meter counters and a "Snapshot routes" section, response headers, last copy served stale when a rebuild fails. Hooks keep their output; admin editing screens keep direct reads (`useTeamMembers(teamId, { live: true })`, drafts in `useAllLibraryMatches`).
The pointer (`users/{uid}.teamId`) is client-writable under today's rules, so the route is EQUAL to the current exposure, not stricter; closing it is the post-release rules hardening.

## Reads, query-count harness (synthetic: 20 members, 1,234 entries, 500 library matches; ratios, not production)
| Page (documents billed) | Before 2a | After 2a, flags OFF | Snapshots ON (device) |
|---|---|---|---|
| Roster, 3 call sites | 60 | 20 | 0 |
| Analytics, cold / repeat | 5,493 / 2,124 | 5,433 / 2,044 | about 4,913 (arithmetic: -20 roster, -500 library) |
| Team Coach dashboard, cold / repeat | 5,032 / 1,664 | 4,932 / 1,544 | about 4,912 (arithmetic: -20 roster) |
| Scout page, Library page | 4,162; 1,000 | unchanged | Library 0 |
| 18 devices, roster + library in one window | about 10,080 | | server 556 once (20 + 500 + 36 user-document reads) |
Scout page is unchanged on purpose (entries are phase 2b). The device column is the server's cost moved, not removed: one rebuild per TTL per team (roster 120 s, library 900 s, library shared by a program).

## Turn ON (Firestore console, document `appSettings/global`, add booleans = true)
`snapshotRoutesEnabled` (master) AND `snapshotRoster` and/or `snapshotLibrary`. Optional map `snapshotTtl` (e.g. `roster: 300`, seconds, bounded 30 to 3,600). Browsers learn it from the public config on the next page load (the server snapshot lasts about 30 s).
## Turn OFF / rollback
Set `snapshotRoutesEnabled` (or the dataset's flag) to false or delete it: every hook reads Firestore directly again, with no deploy. Code: `git revert` the commits (steps 3, 2); the harness expectations go back to the "Before" column.

## Owner's PREVIEW SMOKE TEST (preview deployment, TEST accounts)
1. Set `readMeterEnabled`, `snapshotRoutesEnabled`, `snapshotRoster` = true. Wait 1 minute.
2. Device A: open People (or Analytics). DevTools > Network > the `snapshot/roster` request: `x-snapshot-cache` should be `MISS` (or `REBUILD`) and `x-snapshot-built-at` a time in ms; `x-snapshot-chunks` 1. The page shows "Updated just now" and Refresh.
3. Within 1 minute, device B (or a private window, different account on the SAME team): open People. Expect `x-snapshot-cache: HIT` and the SAME `x-snapshot-built-at`.
4. Admin Panel > Read usage > "Snapshot routes today": roster requests 2, rebuilds or misses 1, hits 1. Under "server: api/snapshot/roster" about the roster size plus one user document per request.
5. A shared cache looks like step 2 then HITs. A per-instance cache looks like MISS on most requests (hit rate near 0%, a different `built-at` each time). If so, report the hit rate and stop: Option B alone is the fallback.
6. Click Refresh: `REBUILD`, then the button counts down 2 minutes; a second click inside it answers `THROTTLED`.
7. Switch OFF `snapshotRoster`: requests stop and People reads Firestore directly.

## Vercel Data Cache to watch (ASSUMED, unverified: no deploy or network from here)
Dashboard > Usage > Data Cache: reads, writes, storage. Assumed: persisted and shared across instances, each snapshot is 1 manifest + n chunk entries (a write per rebuild, a read per request), a roster at 120 s TTL is at most 30 rebuilds an hour per team, and Hobby has monthly allowances for cache reads, writes and storage that I could not confirm. Next.js caps a cache entry at 2 MB (read in `node_modules/next/dist/server/lib/incremental-cache`).

## Verify
`npm run lint` clean (the one old `jsx-ast-utils` notice). `npx tsc --noEmit` clean. `npm test` (FULL): 391 files, 4,918 of 4,918 passed. `npm run test:rules` (Java 21, FTC rules hook timeout): 8 files, 492 tests passed. `npm run build` OK (route `/api/snapshot/[dataset]` present). Mocked and emulator tests only; the cache sharing itself is NOT verified until the preview test above.

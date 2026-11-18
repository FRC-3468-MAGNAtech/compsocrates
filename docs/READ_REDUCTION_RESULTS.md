# Read reduction and the read meter: results

Free plan: 50,000 reads a day. Verified: `npm run lint` clean, `npm test` (381 files), `npm run test:rules` (492 tests, Java 21), `npm run build`.

## Before and after (the query-count harness: mocked Firestore, SYNTHETIC dataset, not production)
Dataset: 20 members, 1,234 entries, 40 legacy rows, 150 other-team rows by the same people, 60 flag states, 160 live and 90 solo sessions, 500 library matches (`lib/read-counts.test.ts`). The real numbers need the meter or the owner's export dry run; the owner's counts are not known here, so treat these as ratios.
| Step | What | Before | After |
|---|---|---|---|
| C1 | changelog dot: fetches on one mount plus 5 refocuses; feed documents for 6 requests in a minute | 6; 360 | 1; 60 |
| C2/B | public config: appSettings reads, cold call then next call | 5, 3 | 1, 0 |
| C3 | app shell live-sessions listener (documents) | 161 | 9 |
| C4 | Scout page / Analytics / Team Coach dashboard, repeat visit within 6 h | 4,162 / 5,493 / 5,032 | 1,294 / 2,124 / 1,664 |
| C5 | sign-in sync calls over 10 page loads in 10 minutes | 10 | 1 |
| C6 | presence reads an hour (6 live scouts, 18 tabs; arithmetic) | 19,440 | 9,720, and the pill listens on 2 pages only |
First opens are unchanged by C4 (the first visit still reads the legacy rows). The characterization tests (`lib/read-reduction.characterization.test.ts`, 12 snapshots) passed unchanged after every step.

## Not shipped, with the reason
- C7 Scout and Event page narrowing to the selected event: DEFERRED. `lib/read-reduction.characterization.test.ts` shows the alias-aware helper matches the full feed for the canonical key and the configured legacy alias, but misses a row stored with a differently-cased key (`2026LAKE`) that the full feed still marks. Production key casing is unknown. Owner: check one old document's `eventKey` and `teamId`.
- Listener linger (decision 7): skipped. The harness's mock does not model Firestore resume tokens, so it cannot show a remount billed in full; the real SDK keeps the target in its persistent cache.
- The legacy queries are NOT narrowed by `teamId == ""` (production shape unknown). The owner will check one old document and decide.
- Part two (D), evidence needed from the meter first: a session-wide entry feed; Analytics as a one-time read with Refresh; lazy-mounted dashboard sources; library by season in Analytics; a bounded audit log and `/api/admin/teams`. Evidence: the Read usage tab's top sources per page over a competition weekend.

## The meter
Turn ON: in the Firestore console open `appSettings/global` and add the field `readMeterEnabled` (boolean) = `true`. Missing or false = OFF: no counting, no timer, no network, no writes; the flag rides on the one cached `appSettings/global` snapshot. Browsers pick it up on the next page load (the server snapshot lasts 30 s per instance).
- Admin Panel > Read usage (platform owner only, both programs): today and 14 days, by page and collection, top 10, the 50,000 line; opening it costs at most 15 reads. Admins can add `?readmeter=1` to any page for a device-only counter (`?readmeter=0` hides it).
- It counts documents browsers and the listed server routes (public config, changelog feed, sign-in sync, admin/teams, share-practice, check-scores, the cron poller) received. It does NOT see rule-evaluation reads, other scripts or uninstrumented routes, so the Firebase console's Usage number will be higher.
- Writes it adds: at most about 900 a day for 15 devices (one per 10 minutes per active device, plus page hides). No rules change.

## Rollback
Each change is its own commit: `git revert` the hash. Meter: set the flag false (or delete it). Hashes: harness c82cc6c, shared settings snapshot fc59d3a, meter c8c5684, changelog a335896, watcher ba9fc4c, legacy cache a288f36, sign-in sync 17ef5d8, presence 6ae78cf, quota experience d18be07, dev:emu 9c3e779. Config note: public settings (team creation, avatar uploads, switches) now show on other server instances within 30 s of a change.

## Manual check (preview deployment or `npm run dev:emu`)
1. FRC vs FTC side by side: sign in, open the dashboard, Scout, Analytics and Scout Accuracy in each program; numbers and layout match what they were. Turn the meter ON, repeat, open Read usage in both programs (same tab, same labels).
2. Meter OFF: DevTools network shows no `/api/read-meter` calls. ON: calls appear about every 10 minutes and when the tab is hidden.
3. Compare the meter's daily total with the Firebase console Usage number for the same Pacific day.
4. Quota: simulate with the emulator (stop it mid-session): one banner, rows stay on screen, a member is not sent to team setup.
5. Presence: a scout live for 3 minutes shows on the Dashboard pill and does not flicker. Open an old entry's `eventKey` and `teamId` in the console and tell me what you see.

# Batch 6 results: FTC live and lobby practice
**Done in code, nothing run in a browser, no real stream, event, scheduler or key** (mocks and the emulator only). `live` and `lobby` are now ON for FTC. Rules: **NONE changed, nothing to deploy.** The pasted brief was cut off mid-sentence in its Context section; I took the replacement design from `docs/FTC_COMPLETION_PLAN.md` section 3.

**The two collection-group queries are gone for FTC (never ported).**
- "Who is live on my team": `data/ftc/live.ts` reads the team's live sessions (`teamId ==`, `kind == live`), derives the match keys of the open ones, and reads each `programs/ftc/liveMatches/{key}/scouts` by path with `teamId ==`. Readers follow the session set (one added, one dropped, all torn down on exit).
- "The lobby I am in": `data/ftc/lobby.ts` lists `lobbies teamId ==`, then for each NON-closed lobby queries `players` by path with `teamId ==` and `uid ==`. It is a query, not a `get`: the emulator proves a `get` of a missing player doc is denied. Equality-only, no orderBy, no new index, no `activeLobbyId` field.
- Both sit behind `ProgramData.live` / `.lobby`; `lib/live-presence.ts`, `lib/lobby.ts`, `lib/practice-sessions.ts` use the port when there is one and keep their own reads otherwise. Writers take a trailing `program`.

**Server.** `resolvePendingLiveMatches` and `resolveLobbyResults` take a `program` and read a `LiveProgramStore` (collections, entry and library readers, the entry patch, the match source, alliance size): default store in `lib/server/live-program.ts` (CS shapes unchanged), FTC's in `lib/ftc/live-store.ts` (accuracy and auto flags stored ON the entry, `programs/ftc/notifications`, push to `/ftc/practice-scouting`). `/api/live/check-scores` and `/api/lobby/resolve-results` take `program` in the body (absent or unknown = default; the lobby route checks the caller's team in THAT program's users). Cron sweeps every program and reports each; the default program failing is still a 500. `detect-event` was already program-aware.

**Parity.** One page, one set of components, no fork. Reused as is: the practice landing page, `LiveFlow`, `LobbyFlow` and their screens, Presence panel, Pending robots, the pill, the score watcher. Config only: `ProgramConfig.event.allianceSize` replaces the fixed `ALLIANCE_SIZE` in live-flow (manual roster inputs), presence panel, lobby flow ("pairs" vs "groups of 3") and the waiting room's group size; `practice.liveTileText` was already config. No new `useProgramData()` reader in `app/` or `components/` (parity guard passes); no place I could not reuse the FRC version.
**Visual differences that remain:** 2 team boxes and 2-player groups instead of 3 (data driven), the FTC tile sentence, FTC events as the match source. Nothing else known.
**FRC changes (all behavior-neutral by intent):** FRC clients now send `{program:"frc"}` to the two routes; fire-and-forget presence, heartbeat and lobby writes got `.catch(() => undefined)` (a failed write no longer raises an unhandled rejection; the store still reports it); live-flow takes its fallback season and session season from `useForms()` (same values as before for FRC today: 2026 and the default season id); rate limit key is `program:uid`; cron adds a `programs` key and sweeps FTC too.
**FRC possible bug, not fixed:** the "still in a lobby / Rejoin" banner reads any status through the collection-group query and the page does not check status, so FRC may offer a closed lobby (the lobby screen then says "closed"). Unverified.

**Additive fields:** none on existing docs. New FTC docs use the shapes the rules already allow: `programs/ftc/liveMatches/*/scouts/*`, `lobbies/*`, `lobbies/*/players/*`, `notifications/*` (Admin-written). TS-only: `ProgramData.live` / `.lobby`, `practice.subscribeTeamLiveSessions`, `useMyActiveLobbyId(uid, teamId)`, `LiveProgramStore`, `lobbyGroupSize(..., fallbackSize)`.
**Added:** `data/ftc/live.ts`, `data/ftc/lobby.ts`, `lib/ftc/live.ts`, `lib/ftc/lobby.ts`, `lib/ftc/live-store.ts`, `lib/live/program-store.ts`, `lib/server/live-program.ts` and tests for each (data layer with mocked Firestore, server with the fake Admin Firestore, routes with mocked token checks, 14 emulator rules tests).

**Verify.** lint 0 errors, 1 warning (`match-list-screen.tsx`, not mine). `npm test`: 3449 pass, 3 fail, all `brand-guard`: 2 as before (FTC names in 9 tracked doc, test and route files, none mine) and 1 mine: `lib/server/live-program.ts` is in `FTC_ALLOWED` but is not git-tracked until you commit it (passes after the commit). `test:rules` 419/419. build pass.
**Left for later:** DOM click tests; live and lobby never run against a real stream, `FTC_API_*`, `CRON_SECRET` scheduler or FCM push; FTC solo practice still forces the placeholder video (Batch 3) while the FTC lobby plays a match's own video; the FTC rejoin banner skips closed lobbies.
**Manual check.**
1) /ftc/practice-scouting: Live and Lobby tiles show, game box disabled.
2) Paste a YouTube link, pick the event (FTC events) and a match, enter two team numbers by hand for an unposted match (2 boxes), pick a robot, scout, submit: "Waiting for official scores".
3) A second account joins from the Presence panel as the partner robot (forced onto the other robot); both submit.
4) Once the FTC API posts the score (or run the poller by hand with the bearer token): both sessions show accuracy, entries show it on Scout Accuracy, a "Scores are available" popup appears.
5) Host a lobby, join with the LB- code from a second account, start (needs an even number, at least 4), submit all, check results and ranking; Play Again; close.
6) Close the tab mid-lobby and reopen: the Rejoin banner appears.
7) A scout of another FTC team cannot join your lobby code.
8) FRC SIDE BY SIDE: run steps 2 to 5 in /frc/practice-scouting and compare tiles, panels, banners, countdown, results, wording, empty and error states.
9) /frc live and lobby still work with 3 robots as before.

**Next step:** run the 9 checks (steps 4 and 6 need the FTC keys and a deployed or local server), then decide on the optional Batch 7 (applications, announcements, sub-ins) in `docs/FTC_COMPLETION_PLAN.md`.

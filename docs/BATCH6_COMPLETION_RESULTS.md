# Batch 6 completion results
Audit of the FTC live and lobby work against the missed brief, then fixes. Rules: NONE changed. Mocks and the emulator only; no deploy, no real key.

## Audit (done / partial / missing, then what I did)
- a Program in routes: PARTIAL, fixed. check-scores, resolve-results and detect-event defaulted an absent or unknown program. Now `programFromBody` (`lib/server/live-program.ts`): missing or unknown = 400 (`program_required` / `unknown_program`), feature off = 400 `program_not_supported`; body only. All clients already send it; the cron calls the resolvers directly with an explicit program.
- b Auth: done for resolve-results (program users doc vs lobby team, 403). check-scores: PARTIAL, fixed (caller needs a users doc with a team in THAT program, else 403). The routes verify the Admin SDK session cookie (`checkSession`), the FRC mechanism, not a bearer ID token. detect-event has no check of its own (`getEvents` requires a session); it reads no user data.
- c Keys: missing = typed `missing_credentials` naming both (done). `warnings` and a rejected key did not name both: fixed (warning text now lives in each program's store, `dataWarnings()`). No key value is logged or returned (tested).
- d Resolution: pending score stays pending, never 0 (done, tested). Idempotency PARTIAL, fixed: the write is one transaction that re-checks the sessions are still pending; the notification is an atomic `create`. EXPIRY MISSING IN FRC TOO (`LOBBY_EXPIRE_MS` is defined and used nowhere; no live limit): not added, see questions.
- e Roles/totals: roles done and tested (new tests use the screens' exact arguments). No total while scouting: nothing renders one. Results: live waits for the score; lobby results PARTIAL, fixed: a scouted group on a match with no official score fell under "Did not finish" and showed official score 0. Now (config `practice.noScoreIsResult`, FTC only) it lists under "No official score yet" with the scouted total. FRC unchanged (tested).
- f Submission toggles: NOT CHANGED, CONFLICT. `saveEntry` deliberately never blocks live or practice (Session E, in CLAUDE.md). Blocking them changes FRC and reverses that decision.
- g Live pill for finished events: NOT VERIFIED (pill/event-status code not audited this session).
- h Drafts: FRC live and lobby have none (no `draftUserId`), so FTC matches. Lobby rejoin works for FTC; missing-player and disconnected states exist ("Connected/Disconnected", closed screen); not run in a browser.
- i Malformed sessions: done (`unreadable-sessions-notice`, flagged for an admin).
- j Tests added: program required (7 shapes, cookie/header ignored), wrong program, no team, unsupported, detect-event 400, key warnings, rejected key (401/403) without values, concurrent poller + client check (once), no overwritten notification, pending retried, live and lobby roles, lobby unscored. Existing: auth 401/503, 2 and 3 seats, absent-value scoring, FRC reads unchanged. MISSING: a submission-toggle test (item f), a rejected-key route test.

## Task 3: FRC rejoin banner is a REAL bug
`useMyActiveLobbyId` (`lib/lobby.ts`, collection-group branch) returns the newest player doc for the uid with no status check, and player docs are never deleted. `practice-scouting/page.tsx:201` only tests the id. So Rejoin shows for any past lobby, closed or not. Smallest fix: in that branch read the lobby doc and skip a `closed` one (as the FTC port does). Not fixed.

## Task 4: Brand guard
Hits: 2 mine (`live-env.ts` named FTC variables: moved into `lib/ftc/live-store.ts`), `live-program.ts` untracked (now committed), 10 older test and route files (Batch 5b/library) that legitimately use the FTC program id: allowlisted by file with a reason each, no patterns. The guard already had the planted-string self-test. Docs are not scanned.

## Verify
lint 0 errors, 1 warning (`match-list-screen.tsx`, not mine). `npm test` 3470/3470. `test:rules` 419/419 (run before the last UI edit; no rules or data layer touched since). build passes. tsc clean. Brand guard 17/17.

## Questions for you
1. Submission toggles (f): should live and lobby be blocked when the team or season is off? That means ending the Session E exemption for FRC too.
2. Expiry (d): FRC has none. Do you want a limit for pending live sessions and stale lobbies (both programs)?
3. `docs/BATCH7_PLAN.md` is untracked and not Batch 6: left out of the commits.

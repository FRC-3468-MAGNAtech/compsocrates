# Session A results: program selector and FTC team setup

Written for: the maintainer. Branch `rebuild`; nothing deployed, no production Firebase touched.

**Task 0.** The foundation exists: `data/ftc/` (24+ files), `config/programs/ftc.ts`, `lib/program/`. `pagesConnected` is true for both programs; `connection.paths` lists 31 FTC paths, `joinRequests` feature off. (The repo is `CompSocrates rebuild/`; the outer folder has no CLAUDE.md.) The selector cards, sidebar and dashboard switcher already existed; what was missing is below.

## What changed
- Selector: `readStoredProgram` + `program` cookie (`lib/program/context.tsx`); `components/program/home-redirect.tsx` (signed in with history goes to `/<program>/dashboard`, no history shows the cards, `/?choose=1` always shows them); grid icon in `ProgramSwitcher`, `ProgramChip` in the topbar.
- Team setup: `components/program/team-setup.tsx` replaces the dead-end text in `ProgramGate` (the moved-accounts sentence is a small note); `lib/team-setup.ts` (validation); `data/ftc/enrollment.ts` (documents, 8-char join code); `createTeam` / `requestToJoinTeam` in `data/ftc/write.ts`; port `enrollment` (`lib/program/data.ts`, `lib/ftc/program-data.ts`).
- Rules (`firestore.rules`, FTC block only, NOT deployed): team create (id = join code format, owner = caller, same batch writes the caller's profile), own-profile create (admin and owner of a team new in the batch), `teams/{id}/joinRequests/{uid}` (own, pending, existing team, no profile yet; read by owner or team admin; withdraw by owner).

## Reused
`generateTeamCode` (`data/cs/join-requests`), `parseTeamNumber`, `programDoc`/`programPath`, `Button`, `Input`, `Label`, `Tabs`, `glass-card`, `ProgramSwitcher`. No logos exist in the program configs (D17), so names only.

## Findings
- The sister app has no join-request document: it joins instantly by code through a server route. The request path is new schema (additive, listed in REMAINING). Its team and profile creation are server-only; the FTC rules said `create: if false`, hence the rules change.
- No `appSettings` gate: FTC code and rules never used `teamCreationEnabled`, so none was added.
- Multi-team: setup creates the account with its first team (`fieldTeams`, `accountTeams`). Adding more is still a Settings follow-up.
- Root (FRC) rules are CS's own and open: any signed-in user can create a root `users/{uid}` or `teams/{id}` doc. Not changed (CS-OPEN); the new tests only assert FTC enrollment writes under `programs/ftc/` and grants no write to others' root docs.

## Tests (run once)
- `npm run lint`: passes (the known `jsx-ast-utils` notice). `npm test`: 2792 tests, 182 files, all pass after fixing 3 tests my change touched (port key list, a write mock) and allow-listing the two results docs in the brand guard.
- `npm run test:rules` (Java 21): 276 of 297 pass. 21 fail, all the known `useContext` harness gap in `data/cs/adapter.emulator.test.ts` (unrelated, not fixed). The 9 new enrollment tests in `data/ftc/rules.emulator.test.ts` pass.
- `npm run build`: passes.

## Not verified
Nothing opened in a browser (no UI run); no real accounts; rules not deployed; cookie redirect untested in a browser.

## Follow-ups
Join-request approval (rule + Team Management panel, then `features.joinRequests`); show a pending request after reload; add/rename teams in Settings; an e2e test of the setup screen; consider a server route for creation (rate limiting) and a root-rules review.

## Manual check (browser, after `npm run dev` with the emulator)
1. Signed out, open `/`: two cards, FRC and FTC.
2. Click FRC: you land on `/frc/...` (login first); URLs unchanged.
3. Click FTC with a new account: the "Set up your FTC team" screen shows two tabs.
4. Create a team (number, name): you land in the FTC dashboard; Team Management shows the join code.
5. Use the grid icon or chip, pick FRC, then open `/`: you go straight to the last program; `/?choose=1` shows the cards.

Next step: build the join-request approval (rule plus Team Management panel) and turn on `features.joinRequests`.

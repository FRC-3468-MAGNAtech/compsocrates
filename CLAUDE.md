@AGENTS.md

# CompSocrates rebuild

CompSocrates (CS, FRC scouting) rebuilt on CompEpicurus's (CE) stack and design. CE and CS are going to be merged into one site later, so keep this code as close to CE's conventions as possible.

## Folder layout
Parent folder `compsocrates-rebuild/` holds three sibling folders:
- `CompEpicurus (reference)/` is **CE. READ-ONLY.** Design and code base.
- `CompSocrates (reference)/` is **CS. READ-ONLY.** It is a copy of the live app and the source of truth for data and event logic. Do not copy its architecture.
- `CompSocrates rebuild/` is **this folder.** All new work goes here. It is its own git repo.

**Never modify CE or CS.** Never connect to a real Firebase project; use the emulator (see Testing).

Read `docs/AUDIT.md` for findings, `docs/ROUTES.md` for the route map and decision log (D1 to D13).

## Where things live (additions to CE's layout)
- `config/` is the only place that names a game, event, API or alias. A future event is a config swap. See `config/README.md`.
- `lib/games/` holds game plugins (`rebuilt`, `reefscape`, `charged-up`) behind one registry: `score`, `flags`, `normalize`.
- `lib/frc/` has the FRC providers (TBA, FIRST FRC API, Statbotics). `lib/ftc/` is CE's FTC provider and stays. `lib/events/` picks one from `config/event.ts`.
- `data/cs/` holds the adapter: typed converters between CS's Firestore documents and CE's in-app types.
- Everything else follows CE (`app/(app)`, `components/`, `lib/`, kebab-case, tests beside modules).

## Conventions (same as CE)
- Next.js 16.3 App Router. Before writing Next code, read `node_modules/next/dist/docs/` (see AGENTS.md).
- TypeScript strict, `@/*` alias, ESLint flat config with `eslint-config-next`. There is no Prettier.
- Tailwind 4. Use CE tokens (`var(--muted-foreground)` etc.). No hardcoded colors or magic spacing.
- Touch targets are 44px or larger on coarse pointers, form text is 16px, and dialogs are bottom sheets on phones.
- Pure logic stays separate from Firebase code, with a `*.test.ts` beside it.

## Commands
- `npm run dev`, `npm run build` (runs the theme contrast guard first), `npm run lint`, `npm test` (Vitest).
- `npm run test:rules` needs the Firebase emulator (`firebase emulators:exec`).

## Key decisions
See the decision table in `docs/ROUTES.md`. In short: adapter over CS's schema (D1), emulator only (D2), all games (D3), all APIs (D4), FTC kept (D5), CE permission model (D6), sub-ins in their own collection (D7), human-player bug fixed (D8), extra CS theme (D9), unknown fields pass through (D10).

## Testing
- `npm test` runs unit tests (pure converters, game scoring, forms, analytics, routes' pure logic).
- `npm run test:rules` boots the Firestore and Auth emulators (project `demo-compsocrates-rebuild` from `.firebaserc`, so it cannot reach a real project) and runs the rules tests, the API route tests and the adapter integration tests.
- Game scoring is golden-tested against verbatim copies of CS's own functions in `lib/games/cs-oracle/` (test-only, do not import from app code).
- Never run a script or test against the production Firebase project. If you need real-looking data, copy it to a staging project first.
- Do not round-trip source files through tools that re-encode text (a scripted edit once garbled em dashes). Use the Edit tool.

## Where decisions are recorded
`docs/ROUTES.md` (D1 to D13), `docs/AUDIT.md` (findings), `docs/REMAINING.md` (gaps and cleanup). Add a row to the ROUTES decision table when you make a new decision, and a line to REMAINING when you leave something undone.

## Rules for changes
- Do not change CS's schema or scoring logic without approval. Scoring changes need a golden test against CS documents.
- Small, logical commits with clear messages.
- Build must pass with no errors or warnings before anything is called done.

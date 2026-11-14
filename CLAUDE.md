@AGENTS.md

# CompSocrates

CompSocrates (CS): scouting app for two FIRST programs, FRC and FTC, on Next.js 16.3 / React 19 / TypeScript (strict). One site, one repo, one Firebase project (CS's), one account across both programs. FRC reads and writes the existing CompSocrates Firestore schema through an adapter (`data/cs/*`); FTC data lives under `programs/ftc/` (see Program model). Plan and status: `docs/MERGE_PLAN.md`.

## Program model
- `config/programs/{frc,ftc}.ts` implement `ProgramConfig` (brand copy, alliance size, season rule, Firestore prefix, greyed-out pages, `pagesConnected`). `useProgram()` / `useProgramConfig()` (`lib/program/context.tsx`) give the active program. A component asks the config; it never names a program.
- Routes: the signed-in app is `app/(app)/[program]/...` (`/frc/scout`, `/ftc/scout`). Source code keeps writing program-relative paths (`"/scout"`): import `Link` from `@/components/program/link` and `useRouter`/`usePathname` from `@/lib/program/navigation`, never `next/link` or `next/navigation` for those. `lib/program/paths.ts` is the one place a path gets its program. Old CS URLs and every unprefixed app URL redirect to `/frc/...` (`config/legacy-redirects.ts`, `APP_SEGMENTS`).
- Selector: home page cards, the sidebar and the dashboard header (`components/program/program-switcher.tsx`). The last-used program is in localStorage.
- Firestore: FRC collections stay at the root, untouched. FTC is `programs/ftc/<collection>` with the sister app's schema; build every program path through `lib/firebase/paths.ts` (`programPath`, `programCollection`, `programDoc`) with an explicit program. FTC rules are the `match /programs/ftc` block of `firestore.rules` (helpers prefixed `ftc_`); FTC code must not use collection-group reads of `scouts`/`players` (the root recursive rules evaluate against the FRC profile).
- `pagesConnected: false` makes the shell show `ProgramGate` instead of the shared pages, because they read FRC collections through `data/cs`. Connecting a program means giving the shared pages a program-aware data layer first. FTC is connected one page at a time: `pagesConnected` is true, `connection.paths` lists the connected paths (the list is in the config and `docs/REMAINING.md`; any other path shows `UnconnectedPage` inside the shell), and `connection.features` says which shell/page data features exist (assignments, sub-ins, practice, live, library, accuracy, changelog, applications, event lookup); a piece whose feature is off does not mount or read. Add a path only when its data layer is program-aware.
- Program-aware data: a hook asks `useProgramData()` (`lib/program/data.ts`, the one shared file that maps a program id to its port). A port (`lib/ftc/program-data.ts`, over `data/ftc/`) serves profile, team doc, scout entries, form entries and forms; `null` (the root program) means the hook keeps its own reads untouched. Non-hook writers take an optional trailing `program` (`saveEntry(..., program)`), like `lib/events/actions.ts`. `ProgramAuth` supplies the program's own profile as `useAuth().profile`.
- Several teams per account (`multiTeam`, FTC only): the team doc lists `accountTeams`, `lib/our-team.ts` holds the one being viewed as (`useOurTeam`, `useAccountTeamChoice`, `useIsOurTeam` for any of them), and `TeamSwitcher` renders only when the program allows it and the person has two or more.
- FTC event data: `lib/ftc/` (FTC Events API) behind `lib/events/actions.ts`, which takes an optional trailing `program` (default FRC). Missing keys return a typed `missing_credentials` error; FRC is unaffected.
- Migration: `scripts/migrate-ce-to-ftc.ts` (dry run by default; never run by the build or tests) with pure rules in `lib/ftc/migration.ts`.
- A guard test (`config/brand-guard.test.ts`) keeps FTC names inside FTC-scoped files (and an allowlist with reasons) and FRC names out of them.

## Reference folders (read-only; the only place the old app is named)
This repo sits in `compsocrates-rebuild/` next to two read-only folders the maintainers still need:
- `CompSocrates (reference)/` is a copy of the live CS app and the source of truth for the data shape and event logic. Do not copy its architecture.
- `CompEpicurus (reference)/` is the sister app this code base started from; its removed features are also kept in this repo's git tag `pre-ce-removal`.

Never modify either folder. Never connect to a real Firebase project; use the emulator (see Testing).

## Folder layout
- `app/` Next.js App Router. `app/(app)` is the signed-in shell (one layout, auth redirect, page guard); `app/(marketing)` is public (landing, login, signup, legal); `app/api` holds the server routes.
- `config/` is the only place that names a product, game, event, API or alias. See `config/README.md`.
  - `brand.ts`: product name, copy, storage prefix, file and export markers, theme color and the logo slots.
  - `event.ts`: season, alliance size, API base URLs, event-key aliases, FIRST code overrides, fallback event key, playoff numbering.
  - `event-names.ts`: static event names (a step of the event-name fallback chain, D14).
  - `games/`: one `GameDefinition` per game (`rebuilt`, `reefscape`, `charged-up`), plus `shared.ts` and `index.ts`.
  - `legacy-redirects.ts`: every old CS URL and its destination (turned into permanent redirects by `next.config.ts`).
  - `cs.ts`, `alliance.ts`: CS identity (owner uid list, default theme) and robots per alliance.
- `config/games/ftc/` holds the FTC program's games in their own registry (D21); `lib/ftc/games.ts` builds their plugins and forms. They are not in the lists above.
- `lib/games/` game plugins behind one registry (`score`, `flags`, `normalize`, verification, prediction, rescout diff). `point-table.ts` generates the plugin for a pure point-table game from its config entry; `rebuilt.ts` is the hand-written plugin for REBUILT's fuel formulas. `cs-oracle/` holds verbatim copies of CS's own functions for golden tests only.
- `lib/events/` is the event facade (types, names, status, actions) and picks the provider per program; `lib/frc/` holds the FRC providers (TBA, FIRST FRC API, Statbotics) and `lib/ftc/` the FTC one.
- `lib/server/env.ts` is the only reader of server environment variables (see Rules).
- `data/cs/` is the adapter: typed converters between CS's Firestore documents and the app's own types (`ScoutEntry`, `FormEntry`, `TeamDoc`, `UserDoc`), plus fixtures and tests.
- `lib/our-team.ts` is the single seam for "our team" (one team per account): `useOurTeam`, `useIsOurTeam`, `OurTeamProvider`. A later multi-team switcher plugs in there and nowhere else (D13).
- `lib/forms/` is the form engine; `game-form.ts` builds a match form from a game definition. `components/`, `lib/` follow kebab-case with tests beside modules.
- Logo: the only artwork is `app/favicon.ico`. Every other logo slot (`mark`, `markDark`, `apple`, `pwa192`, `pwa512`, `pwaMaskable512`, `og`) is a field in `config/brand.ts` that is `null` until official artwork is supplied (D17). Do not add placeholder logos.
- `docs/`: `CS-REFERENCE.md`, `ROUTES.md`, `REMAINING.md`, `ENVIRONMENT.md`, `DEPLOYMENT.md`, `MOBILE.md`, plus `cs-firestore.rules` (CS's production rules, reference only) and `SECURITY-NOTES.md` (sensitive; keep it local).

## Conventions
- Next.js 16.3 App Router. Before writing Next code, read `node_modules/next/dist/docs/` (see AGENTS.md).
- TypeScript strict, `@/*` alias, ESLint flat config with `eslint-config-next`. There is no Prettier.
- Tailwind 4. Use the design tokens (`var(--muted-foreground)` and similar). No hardcoded colors or magic spacing.
- Touch targets are 44px or larger on coarse pointers, form text is 16px, and dialogs are bottom sheets on phones.
- Pure logic stays separate from Firebase code, with a `*.test.ts` beside it.

## Commands
- `npm run dev`, `npm run build` (runs the theme contrast guard first), `npm run lint`, `npm test` (Vitest).
- `npm run test:rules` needs Java and the Firebase CLI; it runs the Firestore and Auth emulators (`firebase emulators:exec`).
- `npm run test:e2e` is Playwright (`npx playwright install chromium webkit` once).

## Testing
- `npm test` runs unit tests (pure converters, game scoring, forms, analytics, routes' pure logic).
- `npm run test:rules` boots the emulators (project `demo-compsocrates-rebuild` from `.firebaserc`, so it cannot reach a real project) and runs the rules tests, the API route tests and the adapter integration tests.
- Game scoring is golden-tested against `lib/games/cs-oracle/` (test-only: do not import it from app code). A scoring change needs a golden test against CS documents.
- Never run a script or test against the production Firebase project. If you need real-looking data, copy it to a staging project first.
- Do not round-trip source files through tools that re-encode text (a scripted edit once garbled em dashes). Use the Edit tool.

## Key decisions
The decision table in `docs/ROUTES.md` is the record (D1 to D19). Short form: adapter over CS's schema (D1), emulator only (D2), all three games (D3, D16), all three data APIs (D4), second provider removed (D5), permission model (D6), sub-ins in their own collection (D7), per-shift human-player fix (D8), CompSocrates theme (D9), unknown fields pass through (D10), playoff numbering (D11), TBA-key event codes (D12), one team per account with the `useOurTeam` seam (D13), event-name fallback chain (D14), brand config (D15), games as config entries (D16), favicon-only logo (D17), env module and CS variable names (D18), shared-login and per-team-key variables not carried (D19).

## Data model and scoping rules
- Scope a read to what the page needs and no narrower. Event pages are event-scoped. Scout accuracy, scout stats and practice
  history are team-wide and cross-event: never filter them by the selected event.
- A CS document can lack the field the app's query filters on. Old CS read practice sessions by `scoutId` or `scoutName`
  (`teamId` is `""` when the scout had no team). Practice sessions are read in `lib/practice-extras.ts` (team query plus the team's
  members by uid and name, fetched once and shared); `data/cs/practice.ts` maps them. Do not add a `teamId ==` to a practice read.
- Session ownership is `scoutId`, else the member whose name matches (case-insensitive). Stats skip live (`csLive`), other-game,
  excluded (`excludeFromAccuracy` field or a `scoutingFlagStates` `practiceSession:<id>` row) and accuracy-less sessions; a missing
  accuracy is never a 0.
- A read that fails must say so: use `reportFirestoreError` and `describeFirestoreError` and show the error, never an empty list.
- Practice sessions must never be hidden by event-name resolution or event validation.
- Why: `docs/FIREBASE_FINDINGS.md`.

## Rules for changes
- Do not change CS's schema or scoring logic without approval. Additive fields are listed in `docs/REMAINING.md`; add to that list when you write a new one.
- **Environment:** the FTC keys (`FTC_API_USERNAME`, `FTC_API_KEY`, optional `FTC_API_BASE_URL`) are group `ftc` (section D of `.env.example`); the migration script alone reads `CE_ADMIN_*` and `CS_ADMIN_*`. Server code reads environment variables only through `lib/server/env.ts` (add the getter and an `ENV_VARS` entry, and keep `.env.example` and `docs/ENVIRONMENT.md` in step; a test checks the first two). Browser-inlined `NEXT_PUBLIC_*` values need a literal `process.env.NAME` access and are the exception. Never reference `NEXT_PUBLIC_TBA_API_KEY` from client code: despite its name it is a server secret.
- **Programs:** FRC-only and FTC-only names, fields and API calls stay in their own scoped files (`config/programs/<id>.ts`, `lib/frc`, `lib/ftc`, `data/cs`, `data/ftc`). Shared code reads `ProgramConfig`. A user in one program never sees the other's data or names.
- **Brand:** every user-visible product string, browser-storage key, exported-file marker and logo path comes from `config/brand.ts`. Do not write the product name or a storage key literal elsewhere.
- **Games, events, aliases:** change `config/`, not components. A new game is one `config/games/` entry (plus a plugin only for cross-field scoring).
- **Our team:** read the account's team through `lib/our-team.ts`, never from the team doc ad hoc.
- Run no code against production Firebase. Do not commit secrets or `docs/SECURITY-NOTES.md` to a public repository.
- Small, logical commits with clear messages. Add a row to the ROUTES decision table when you make a new decision, and a line to REMAINING when you leave something undone.
- Build, lint and tests must pass with no errors or warnings before anything is called done.

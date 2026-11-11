# config/

The only place that names a product, a game, an API, an alias or an alliance size. A new event or season is a change here (plus, at most, a hand-written plugin for scoring with cross-field logic), never a hunt through components. All of it is pure data and pure helpers, safe to import from client code; no key lives here.

| File | What it holds |
|---|---|
| `brand.ts` | The product name, browser title, tagline and descriptions, domain, email sender name, browser-storage prefix, export-file marker, download file prefix, web app theme color, and the **logo slots** (`favicon`, `mark`, `markDark`, `apple`, `pwa192`, `pwa512`, `pwaMaskable512`, `og`). Only `favicon` is set; the rest are `null` until official artwork exists. The manifest and page metadata read these, so setting a slot is the only step. |
| `event.ts` | The season, alliance size (3), API base URLs, TBA key aliases (`2025lake` and `2026labr` to `2026lake`), FIRST code overrides, the fallback event key (`app-testing`), playoff numbering (D11). Keys are read on the server through `lib/server/env.ts`. |
| `event-names.ts` | Static event names, the third step of the name chain (API name, then a name stored in the team's data, then this table, then the raw key). Every entry is a name CompSocrates's own code states. |
| `alliance.ts` | Robots per alliance (3) and slot helpers (`red1`..`blue3`). Follows `event.ts`. |
| `cs.ts` | CompSocrates-specific identity: the platform owner uid allowlist (`NEXT_PUBLIC_RELEASE_OWNER_UIDS`, falling back to `RELEASE_OWNER_UIDS`) and the theme id a CS account gets when its stored theme is unknown. |
| `games/` | One `GameDefinition` per game (`rebuilt.ts`, `reefscape.ts`, `charged-up.ts`) and `definition.ts` (the type), `shared.ts` (verification tolerances, prediction tiers, accuracy thresholds, the standard incident list, rescout helpers) and `index.ts` (the registry list). Declarative only. |
| `legacy-redirects.ts` | Every old CS URL and where it goes. `next.config.ts` turns it into permanent redirects; `legacy-redirects.test.ts` fails if a CS route has no destination. |

## Adding a game or season
1. **A pure point-table game** (points per tally, per toggle, per chosen option): add `config/games/<game>.ts` with a `GameDefinition` (sections, fields with their points, incidents, flag rules, rescout fields, difficulty thresholds) and list it in `games/index.ts`. The plugin (`lib/games/point-table.ts`), the match form (`lib/forms/game-form.ts`), the season (`lib/seasons.ts`) and the analytics Game filter are generated from it.
2. **A game with cross-field scoring** (REBUILT's fuel formulas): the same entry carries the numbers and names a `formulas` plugin in `lib/games/`, and the form is built by hand in `lib/forms/builtin-<game>.ts`.
3. Golden-test the scoring against the original app's own functions (`lib/games/cs-oracle/`, test-only) and add a case to `data/cs/per-game.test.ts`.
4. `config/event.ts`: the season, if it changed.

Value keys follow the convention in `lib/games/types.ts`: a CS doc field at `phase.field` is the form value key `phase_field`.

## Environment
See `.env.example` and `docs/ENVIRONMENT.md`. The secrets are server-only (`NEXT_PUBLIC_TBA_API_KEY`, which keeps CompSocrates's variable name but is read only on the server, `FIRST_API_USERNAME`, `FIRST_API_TOKEN`, the Firebase Admin trio). Do not reference `NEXT_PUBLIC_TBA_API_KEY` from client code, and never put another key in a `NEXT_PUBLIC_*` variable.

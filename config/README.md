# config/

The only place that names a game, an API, an alias or an alliance size. A new event or season is a change here (plus, at most, a form definition and a game plugin), never a hunt through components.

| File | What it holds |
|---|---|
| `event.ts` | The season, alliance size (3), API base URLs, TBA key aliases (`2025lake` to `2026lake`), FIRST code overrides, the fallback event key, playoff numbering (D11). No keys live here; they are read on the server through `lib/server/env.ts`. |
| `alliance.ts` | Robots per alliance (3) and slot helpers (`red1`..`blue3`). Follows `event.ts`. |
| `cs.ts` | CompSocrates-specific identity: the owner uid allowlist (`NEXT_PUBLIC_RELEASE_OWNER_UIDS` / `RELEASE_OWNER_UIDS`) and the default theme id. |
| `games/` | One file per game (`rebuilt`, `reefscape`, `charged-up`): scale tables, point values, incident lists, starting positions, verification tolerances, flag thresholds, prediction tiers. Declarative only. |
| `legacy-redirects.ts` | Every old CS URL and where it goes. `next.config.ts` turns it into permanent redirects; `legacy-redirects.test.ts` fails if a CS route has no destination. |

## Adding a game or season
1. `config/games/<game>.ts`: the numbers and labels.
2. `lib/forms/builtin-<game>.ts`: the form (CE's form engine; value keys follow the convention in `lib/games/types.ts`).
3. `lib/games/<game>.ts`: a plugin only if the scoring has cross-field logic. Golden-test it against the old app's own functions.
4. `lib/seasons.ts`: one entry.
5. `config/event.ts`: the season, if it changed.

## Environment
See `.env.example`. Secrets are server-only (`TBA_API_KEY`, `FIRST_API_USERNAME`, `FIRST_API_TOKEN`, Firebase Admin). Never put a key in a `NEXT_PUBLIC_*` variable.

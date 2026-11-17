# Pre-release hygiene (branch `release-prep`)

No app behavior, rules, schema or UI changed. Nothing deployed, no real Firebase project touched.

## Dependencies (exact-pinned)
- `next` 16.3.3 to 16.4.6, `eslint-config-next` 16.3.3 to 16.4.6, `sharp` 0.35.4 to 0.35.5.
- Lockfile: only the next, @next/*, sharp and @img/sharp-* families moved, plus three side effects: `fastq` 1.20.1 to 1.20.3 (npm re-resolve) and new `@emnapi/core` and `@emnapi/runtime` (sharp's wasm32 build). The root entry also changed (the pins).
- Not touched: Firebase, grpc-js, zod, @vercel/*, source-map-js (their audit findings stay open; reasons in SESSION_I_RESULTS).
- Server Actions (`lib/events/actions.ts`, 25 tests) and `next/image` (no `images` config) fine; build passes. The only 16.4 breaking note in the bundled docs (`appNewScrollHandler` removed) is not used here.

## E2E (`chromium-desktop`, production build, Firestore and Auth emulators running: the ECONNREFUSED :8080 noise is gone)
- 93 passed, 1 failed, 3 skipped (phone-only, by design). Was 11 failed.
- Stale tests updated: `/frc` path prefix (3), `Alliance` exact name, form display name in the empty state, required-notice locator (`<output>` has a status role), page-access row count derived from `accessPageGroups`, pit form labels ("game pieces", "Collect From The Station"), `notes-tab` check phone-only.
- LEFT ALONE, open: `profiles.e2e.ts` "a public profile, seen by a teammate". It expects dimmed unearned badges (`ten-sessions`, `fifty-sessions`, ids still in `lib/achievements/builtins.ts`) but the page does not render them. Commit d3bdf93 ("others see earned only") suggests this is deliberate, so the likely fix is the test, but it was not changed without an owner decision.
- Cross-browser (same build, fastest specs, nothing fixed): `webkit-desktop` and `chromium-phone`, 91 passed, 3 failed in 2.1 min: the profiles test above on both, plus webkit `match-list` "a manual refresh asks again" (the refresh button is not seen disabled in time: likely timing in WebKit, not investigated). `webkit-phone` not run.

## Brand guard
- Policy fix in `config/brand-guard.test.ts`: tests and fixtures (`*.test.*`, `*.spec.*`, `*.e2e.*`, `e2e/`, `app/e2e/`, fixture folders) may use program ids and names as data; non-test FRC source, user-visible FRC strings and the sister app's name (never exempt, tests included) stay strict. Header explains it, a redundant test-file allowlist entry now fails, 36 entries removed, `scripts/audit-event-attendance.ts` listed with a reason, 3 self-tests added. The BIOBUZZ comment in `my-scouting-filters.ts` is now game-neutral.
- 20 of 20 guard tests pass.

## Checks (final)
- `npm run lint`: 0 errors, 0 warnings (the known jsx-ast-utils notice). `npm test`: 4127 of 4127 (325 files). `npm run test:rules`: 434 of 434 (7 files). `npm run build`: passes (theme guard 434 checks, 49 static pages). `npx tsc --noEmit`: clean.

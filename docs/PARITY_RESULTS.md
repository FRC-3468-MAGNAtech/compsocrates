# Parity results (Phase 2)

Report: `docs/PARITY_REPORT.md`. Branch `rebuild`. No data schema, scoring, rules or FRC behavior changed except as listed.

## Done
- **A. Practice:** one game step (`SeasonSelect`, one card for FTC, from `useForms().seasons`); "Any difficulty" and the Event dropdown for both programs; one empty-state wording; results loading rule is `ProgramConfig.practice.noScoreIsResult` (FRC off, FTC on). NOTE in `results-screen.tsx`: FRC's skeleton-until-accuracy can hang on a session with no official score (unchanged, flip the flag when accepted). `UnreadableSessionsNotice` stays FTC-only.
- **D. Sidebar:** pages a program lacks are hidden in the sidebar, mobile drawer and customizer (`canShowPage` in `lib/sidebar/resolve.ts`); greyed-out rendering deleted. Unconnected pages unchanged.
- **C.** One `ImportPreview` for CSV import (FRC keeps its all-or-nothing rule via `blockOnErrors`; the admin-only gate stays); one join-request error message; one `ProgramSetupFrame` for both team-setup screens, and the greeting now shows in both.
- **F.** Scout Status uses the shared Select (`EventTargetSelect`, no hardcoded color); the Live tile sentence is `ProgramConfig.practice.liveTileText`; one `COMPARISON_COLUMNS` table (2 to 5) and one `ComparisonRow` for solo and live results.
- **Slots:** `ScheduleGrid` empty state used the FRC alliance size for FTC; it now follows the program (`slotColumns`).
- **Tests added:** 2 and 3 robots in `ComparisonRow` (solo and live results share it), 2 and 3 slots plus the empty state in `ScheduleGrid`, `SeasonSelect` with 1 and 3 games, `DifficultySelect` per program, `EventTargetSelect`, sidebar hide under default layout and config. Sidebar customizer test updated (no greyed text).
- **Guard:** `config/parity-guard.test.ts` fails on a program-id comparison in `app/` or `components/`, and on any NEW `useProgramData()` reader not listed with a reason (15 listed).

## Checks (once)
- `npm run lint`: 0 errors, 1 warning (`match-list-screen.tsx` unused `timeZone`, not mine).
- `npm test`: 3238 passed, 5 failed (234 files, 1 failed). All 5 are `config/brand-guard.test.ts` hits in files I did not touch (`docs/FTC_COMPLETION_PLAN.md`, `docs/BATCH4_RESULTS.md`, `docs/SESSION_C_RESULTS.md`, `e2e/sidebar-builder.e2e.ts`, `app/e2e/sidebar-builder/fixture.tsx`, `lib/scroll-reset.test.ts`, `lib/analytics/*.test.ts`, `lib/analytics/recompute-policy.ts`, `lib/scout-stats/*.test.ts`). Not fixed.
- `npm run build`: passed. Emulator and e2e suites not run.

## Still different (accepted or next)
- **Group B is done** (`docs/LIBRARY_MERGE_RESULTS.md`): one Match Library panel, and its dialogs follow the program's alliance size. The live and lobby flows still read the fixed `ALLIANCE_SIZE` (Batch 6).
- Team setup: after submitting, FRC shows "Waiting for approval" and FTC shows "Request sent" (different post-submit screens); the frame, card and greeting match.
- FTC has the admin tabs Forms (with its templates), Sessions, Rescore and Backups since Batch 5b; it still lacks Entries, the two ID tools and Setup Check, and 8 pages (`connection.paths`): unported, not in scope.

## Side by side (open `/frc/<page>` and `/ftc/<page>` in two windows)
- **/practice-scouting:** first step is the same "Choose a season" cards (FTC: one card); difficulty step has the same four tiles; match picker has the Event dropdown, same empty text; results Comparison tiles line up (FTC 2 robots).
- **Sidebar, drawer, Admin > Sidebar:** FTC has no greyed entries; the customizer lists the same pages the sidebar shows.
- **Analytics > Match Scout > Import CSV:** same dialog and preview layout; an FRC file with a bad row shows the errors and no Import button.
- **Team Management > Join requests:** deny or approve a failing request: same sentence.
- **Account with no team:** same frame, selector position and greeting.
- **Analytics > Scout Status (2+ events):** the "Editing targets for" select looks like every other select.
- **Assignments:** FTC grid has Red 1-2 / Blue 1-2, also before a schedule exists.

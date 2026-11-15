# Session D results: stale match status, archived events, My Scouting game select

## Task 1: Match List showed old events as live (diagnosis)
- `buildMatchRows` (`lib/match-list/model.ts`) never asked whether the EVENT had ended. It only compared "now" with each unplayed match's start.
- Practice (P) matches come from the FIRST schedule, which carries no scores, so `played` stays false for ever. For a finished event every P row stayed Upcoming, and the first one got the "Next" ring. Matches with no start time never left Upcoming either.
- Time zone: FIRST's offset-less wall time is parsed on the server (`first-map.ts` `parseStartTime`) and re-serialised as `Z`, so the event's local time is read as UTC. Not fixed here (see Next step): it shifts In Progress by the venue's UTC offset on live events.
- Cache: not the cause. The schedule cache lives 3 minutes in memory, and a failed refresh keeps the last good list but flags the error.
- Fix: `hasEventEnded` (`lib/events/event-status.ts`: end date in the event's own timezone; with no dates, an earlier season than `currentSeasonFor(program)`). An ended event's rows are all Completed, with no In Progress, no Next. Practice rows also complete once a qualification match has a result. Event dates and a "Completed" badge show under each event.

## Task 2: Archive
- `lib/events/archive.ts` (pure), `components/event/archived-events-section.tsx`, Archive button on Selected events, `setArchivedEvents` in `lib/team.ts` (FRC merge write) and `data/ftc/write.ts` (FTC path through the program port).
- `useActiveEvents()`: `events`, `primary`, `primaryCode` now exclude archived (pickers: Match Scout, forms, Assignments, Practice Scouting, Match List, dashboard). An archived primary falls back to the first current event, or the empty state. Added: `allEvents`, `archivedEvents`, `archivedCodes`, `storedPrimaryCode`; `isActive` still counts archived.
- Cross-event pages use `allEvents`: My Scouting, Scout Accuracy, Profile. People uses `isActive`. No data read filters on `archived`.
- Analytics: archived events leave the Events list unless "Show archived events" is on (checkbox, only when something is archived) or one was opened explicitly. "All events" still reads everything.
- Known limit: archived events still count toward the 10 selected events limit.

## Task 3: My Scouting game select
- `components/scout-stats/game-select.tsx` extracted from Scout Accuracy, now used by both pages (programs' games from `useForms().seasons`; one game: disabled).
- URL `?game=` (default: current game, `all` = every game). `lib/scout-stats/game-filter.ts` filters entries and sessions; no `game` counts as REEFSCAPE for FRC (`event.unspecifiedGameId`, else the default game). Loading, empty ("No REEFSCAPE entries yet") and error states added.

## Additive fields
- `archivedEvents: string[]` on `teams/{id}` and `programs/ftc/teams/{id}` (listed in `docs/REMAINING.md`). `ProgramEventRules.unspecifiedGameId?` (config only). No schema or scoring changes.

## Verify
- `npm run lint`: 0 errors. `npm run build`: passes.
- `npm test`: 2867 passed, 1 failed (188/189 files). Unrelated, not fixed: `config/brand-guard.test.ts` flags `/ftc/scout` in `lib/scroll-reset.test.ts` and FTC names in `docs/SESSION_C_RESULTS.md` (both from Session C).
- Not run: Firestore emulator tests, e2e. Scout Accuracy still maps a missing session `game` to REBUILT (`seasonIdForGame`), unlike the new My Scouting rule.

## Next step
Fix FIRST schedule times (keep the wall time and the event timezone instead of `Z`), and decide whether Scout Accuracy should treat a missing game as REEFSCAPE like My Scouting now does.

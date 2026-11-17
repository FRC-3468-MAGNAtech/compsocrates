# Session 5: My Scouting filters show only what applies to the person (results)

Branch `rebuild`. Display and filtering only: no read, rule, schema, write or deploy changed. Reads stay team-wide; the person's data is picked out client-side by uid.

## What changed
- `lib/scout-stats/my-scouting-filters.ts` (pure, both programs, 24 tests): `deriveMyScoutingFilterOptions` gives role, event and game options from the person's WHOLE dataset. Also `keepValid`, `storedEventKeys`/`storedEventKey`, `effectiveGame`.
- Roles: shared `userRoles` accessor (primary + secondary) plus roles their own entries show (`scoutEntries` are Match Scout entries, so any own entry shows Match Scout). Hidden below two.
- Events: attendance lists they are on plus their event/live entries, through `canonicalEventKey` (aliases fold, stored spellings kept), named with the year, archived tagged "(Archived)", newest first. Hidden below two.
- Game: games in their entries and sessions plus the current one; one game shows disabled (shared `GameSelect`).
- Ranking basis hides while it only has "Preserve"; Calculation lists only their events; no data at all shows the empty state, no filters.
- `my-scouting/page.tsx` and `FiltersBar` (new optional `personal` prop; Scout Accuracy unchanged). No new dropdown, program-id comparison or `useProgramData()` reader. A failed attendance read falls back to entries-only events, silently.

## Task 3: Assignments archived events
No change: the page-level event select already has "Show archived events" (default off, "Archived events" group, `f91ab5f`; tested in `lib/events/archive.test.ts`). Scouting pickers still skip archived events.

## Verify
- Lint clean, build passes, `npm test` 3732 passed, 2 failed (286/287 files).
- Unrelated failures, not fixed: `config/brand-guard.test.ts` x2 (fail without my changes too; they flag `lib/profile/events-attended.test.ts` and `scripts/audit-event-attendance.ts` for FTC names).
- New: `my-scouting-filters.test.ts` (24), `components/scout-stats/filters-bar.test.tsx` (4, two people on one team get different options).

## Decisions
- Roles = current roles + roles shown by their entries.
- A stale `?game=` falls back to the current game (the no-choice default), not "All games". A person with one game gets that game, so rank is within it.
- Single-event calculation compares one stored spelling; only legacy aliased keys could undercount.
- Rules changed: none. Rollback: revert the commits (nothing stored).

## Task 4: other filters (not changed)
- `scout-accuracy/page.tsx` via `filters-bar.tsx`: all nine roles and team/active events. Fix: derive from the team's member roles and attendance/entries (like `member-multiselect.tsx:28`).
- `components/dashboard/role-switcher.tsx:59`: lists every role; a non-admin should see only `userRoles`.

## Manual check (not run: needs a browser and sign-in)
1. One-role member: Role filter hidden, Event filter only their events, with years. 2. Multi-role member: all of theirs, only theirs. 3. Archived event shows "(Archived)". 4. Reload with `?game=junk`: resets, no error. 5. New member: empty state. 6. Assignments: Show archived events, open an old event. 7. Side by side `/frc/my-scouting` and `/ftc/my-scouting`.

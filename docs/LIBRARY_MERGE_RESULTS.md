# Match Library merge (Group B) results
**Done, nothing run in a browser** (no keys, no jsdom: panel tests are first-render only; click flows are covered at the data layer). FRC and FTC now use ONE panel: Imported and Manual tabs (`match-library-panel.tsx`, `library/imported-library-panel.tsx`, `manual-library-panel.tsx`), the FRC dialogs, fast entry and bulk import, over `LibraryAdapter` (`lib/library/adapter.ts`: `rootLibraryAdapter` for FRC, `ProgramData.library` for FTC). What differs is `ProgramConfig.library` (scores optional, schedule import, a time on a match, which tools exist), never a program id. Parity guard: no new reader in `app/` or `components/` (the reader is `lib/library/adapter.ts`); the two panel entries are removed.
**Safety net.** The FRC characterization tests (store writes, API import, panel states, fast entry and bulk template) were committed alone first and pass unchanged after the merge.
**Reused from FRC:** panel layout, tabs, event and match dialogs, fast entry, bulk dialog, `Select`, delete confirm, row heights, copy. **Not reusable, so config:** official score optional (blank is "No score", never 0), a Time column and field, the Score action on imported rows (the API gives only a schedule), 2 vs 3 team slots.
**Alliance size** follows `ProgramConfig.event.allianceSize` in the match dialog, fast entry, bulk template and validation. Not touched (Batch 6): live and lobby flows read the fixed `ALLIANCE_SIZE`.
**FRC changes (all approved defaults):** Imported tab gains an "Imported event" dropdown, a Status column and Publish/Unpublish (per match and all); the root hooks now return `error` and `retry` (a failed FRC read used to look empty; the panel now says so). Stored ids, collections and fields are unchanged.
**FTC changes:** dialogs are FRC's; scores are typed in the match dialog (blank clears; fast entry and bulk keep a stored score); Edit event, default video and video per match (inline row, Set video link) are new; Delete event now refuses while it has matches (as FRC). Imports keep stable ids, 400 per batch, audit entries, typed key errors; hand entry works without keys.
**Visual differences that remain:** FTC-only Time column and Score action; "Refresh schedule" vs "Refresh scores"; 2 slots; Update library, placeholder-video switch and video CSV exist for FRC only (hidden for FTC, not greyed). No other known difference.
**Deleted:** `schedule-library-panel.tsx`, `schedule-fast-entry.tsx`, `schedule-bulk-import.tsx`; from `lib/library/schedule.ts` the FTC form, bulk and event-list helpers (and their tests, replaced by tests of the shared validators). **Added:** `lib/library/adapter.ts`, `library/imported-library-panel.tsx`, `match-score-dialog.tsx`, `alliance-cell.tsx`.
**Additive fields (also in REMAINING.md):** FTC library matches may now carry `notes` and `video` written by the shared dialog; TS-only `ProgramConfig.library`, `ValidMatch.scheduledTime`, `ManualAlliance.scoreKnown`.
**Rules: NONE changed, nothing to deploy.** Roll back: `git revert` the merge commits (the characterization tests stay).
**Verify.** lint 0 errors, 1 warning (`match-list-screen.tsx`, not mine). `npm test`: 3383 pass, 2 fail (`brand-guard`, same 7 doc and test files as before this work). `test:rules` 405/405. build pass.
**Left for later:** video CSV import and the placeholder-video switch for FTC (need program-aware writes); the completed-sessions warning when editing an FTC match; a time field in fast entry and bulk for FTC; select-all toolbar on the Imported tab (Publish all / Unpublish all instead); DOM click tests; the live and lobby alliance size (Batch 6).
**Manual check.**
1) /frc/admin > Match Library: Imported tab (import an event, publish and unpublish a row, edit a video), Manual tab (add by hand, fast entry, edit, delete).
2) /ftc/admin > Match Library: same layout and dialogs.
3) FTC: New manual event, add two matches by hand (2 team boxes, scores optional), edit one with a score, then blank it.
4) FTC: import an event twice, no duplicates; matches start "Needs review", Publish all.
5) FTC imported row: Score dialog set and clear.
6) FTC: set a video on a match, then check Practice Scouting plays it.
7) Scout match picker and Practice Scouting show published matches in both programs.
8) A non-admin gets no Admin tab.
9) SIDE BY SIDE: open both library tabs and compare layout, buttons, wording, row heights, and the empty state (new account) and error state (offline).
10) FTC: delete an event with matches is refused until they are deleted.

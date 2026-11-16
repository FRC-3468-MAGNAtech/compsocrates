# Session 9: editing legacy changelog entries, and posted / edited times (results)
Branch `rebuild`. No rule changed, nothing deployed, no production read or write, no script run (mocks and synthetic fixtures only). The importer was not touched.

## Root cause of "editing a legacy entry changes its date"
No code reset the date. The editor opens with the stored date, the server stores the submitted one, and sort and display never read `updatedAt`. The real risks were: (1) the Date field was a plain editable input; (2) unpublish then republish gave a legacy entry a new `publishedAt`, which was its sort tie-break, so it could move among entries with the same date; (3) imported dates are the UTC day of the old creation time, so an evening note can be a day off (not edit-related).

## What changed
- **Date and position:** a legacy entry's Date is locked ("Original date from CompSocrates v1", "Unlock to change", relocks after Save, help text on the UTC day). The server also refuses a changed date on a legacy entry unless `dateUnlocked: true` (400 `date_locked`). A legacy entry's tie-break is `createdAt` only; current entries keep `publishedAt ?? createdAt`. `legacy` is carried through every save. The release date is still a `YYYY-MM-DD` calendar string shown in UTC (never shifted); no stored value was rewritten.
- **Editing:** item text, category, per-item tags, add, delete, reorder (buttons, Alt+Arrow), title, version, tags, publish, unpublish already worked for legacy entries. New: a checkbox per item, "select all" per category, "Move selected to...", "Delete selected" (confirmation), Undo until Save (`lib/platform-changelog/selection.ts`).
- **Times (additive):** `postedAt` (display only; set once by the server at the first publish of a current entry, or from `publishedAt` on the next save of an already published one; never cleared by unpublish, never restamped by republish; legacy get none automatically), `editedAt` + `editedBy` (uid). `publishedAt` is unchanged and still drives the unread dot and ordering; the dot never reads `postedAt`/`editedAt`.
- **Edited stamp:** on a content save of an entry that is already published, unless "Don't record this edit" (ticked by default for legacy only). Not stamped for drafts, publish, unpublish or create (so Edited is never earlier than Posted on the page).
- **Owner overrides:** "Time posted" and "Last edited" date-time inputs (local time, stored UTC) with Clear; only changed fields are sent. Server: valid integers, not over 5 minutes ahead, edited not before posted; owner only. A Cleared posted time is stored as `null` and not refilled.
- **Audit:** `details.times {before, after}` when a save changes them; `details.date {before, after}` when a date changes.
- **Page:** a line under the title, "Posted ... · Edited ..." (each only if present), viewer's zone and locale, `<time datetime>`, tooltip with full timestamp and zone (`components/changelog/entry-times.tsx`, `lib/platform-changelog/times.ts`). Documents without the fields render as before.
- **Fill from import:** a button for a legacy entry at `rev === 1` fills Time posted from `publishedAt` and Last edited from `updatedAt` only if later than `createdAt`; it fills the form, you press Save. Hidden at `rev > 1`.
- One editor and one page for both programs; no program-id comparisons (parity guard passes).

## Verify
`npm run lint`: 0 errors, 0 warnings. `npm test`: 3915 pass, 3 fail, 306 files. Build passes. `test:rules` not run (no rule changed). The 3 failures are the brand guard on files this session did not touch (`components/page-access/matrices.test.tsx`, `lib/profile/events-attended.test.ts`, `lib/scout-stats/my-scouting-filters.test.ts`, same as Session 7): not fixed.
Tests: characterization (committed first, run against the old code), route tests (date lock, republish does not move a legacy entry, posted once, edited stamp, validation, non-owner, conflict, audit), pure times and selection tests, render tests for the date field, time fields, selection bar and the time line. An old route test that overwrote a legacy date was changed to submit the same date.

## Rollback
Revert the Session 9 commits. The new fields are ignored by older code; stored documents need no change.

## Left for later
Date normalization of an epoch `date` (none exists today). A real-DOM test of the dialog (no jsdom here: the pieces are render-tested, the state logic is in pure helpers). The patch script for times and the split action were dropped by decision.

## Manual check (O = owner account)
1. O: Admin > Changelog > Legacy entries > open "CompSocrates v1.4.1": the date is locked, labelled "Original date from CompSocrates v1".
2. O: select the stray "Added:" and "Fixed:" items, Delete selected, confirm; select several real notes, Move selected to Fixed; try Undo; Save.
3. O: the date, list position and Legacy label did not change and another account shows no unread dot; Unpublish then Publish it: it does not move.
4. O: Fill from import (only if never saved), or type Time posted / Last edited, Save; open the Changelog and see them in your local zone (hover for the full timestamp). Clear both: only the date shows.
5. O: publish a new entry: "Posted" shows now; edit it: "Edited" appears; an account that already saw it gets no dot. "Don't record this edit" is ticked by default only on legacy entries.
6. SIDE BY SIDE: open the Changelog in /frc and /ftc: same layout, same time line.

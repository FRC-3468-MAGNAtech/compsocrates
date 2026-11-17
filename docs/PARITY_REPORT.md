# Parity report: FTC vs FRC (Phase 1, report only)

Method: grep only, no code changed. Most pages are already ONE shared page under `app/(app)/[program]/`; there is no
`program === "ftc"` branch, no `isFtc`, no ported CE component folder and no forked stylesheet (only `app/globals.css`).
FTC divergence comes through `useProgramData()` (the "port") and `connection.*` config. Findings below.

## Findings (grouped by shared cause)

### A. Practice Scouting: `useProgramData()?.practice/library != null` swaps UI (not just data)
| Page | Deviation | Cause | Fix | Size |
|---|---|---|---|---|
| /practice-scouting (start) | FRC: `SeasonSelect`, a "Choose a season" card grid. FTC: a disabled `GameSelect` dropdown plus a "Start practice" button. Different control, layout and copy for the same step. | `practice-scouting/page.tsx:273` forks on `ownStore` | One game step for both: render the shared `SeasonSelect` cards (1 card for FTC) and drop the FTC branch | S |
| /practice-scouting (difficulty) | FTC adds an "Any difficulty" tile (4th card in a 3-col grid). | `onSelectAny` only when `ownStore` | Keep as data difference only if FRC also gets it, or accept (FTC matches can have no score). Needs your call. | S |
| /practice-scouting (match pick) | FTC shows an Event `Select` above the list and filters by it; FRC shows one flat library list. Different empty-state copy ("No practice matches published yet..." vs "ask an admin to import one..."). | `match-select.tsx` `ownLibrary` (about 8 branches) | Drive from config (`library.scope: "event" or "flat"`) and one shared wording; or give FRC the event filter | M |
| /practice-scouting (results) | Different loading rule: FTC treats "no accuracy" as a result, FRC shows a skeleton forever until accuracy exists. | `results-screen.tsx:34,61` `noAccuracyIsResult` | Parametrize as a config flag; the rendering is already shared | S |
| /practice-scouting (admin note) | `UnreadableSessionsNotice` only FTC. | `ownStore && isAdmin` | Accept (data-quality notice for FTC docs), or show for both | S |

### B. Admin > Match Library: two parallel panels
| Page | Deviation | Cause | Fix | Size |
|---|---|---|---|---|
| /admin (Match Library tab) | FTC mounts `ScheduleLibraryPanel` (698 lines) with `schedule-fast-entry`, `schedule-bulk-import`; FRC mounts `RootMatchLibraryPanel` (317 lines) with `admin/library/*` (`fast-entry`, `bulk-import-dialog`, manual dialogs). Two sets of dialogs with different row heights (`h-11` vs `h-9`), copy, and layout. | `match-library-panel.tsx:39` picks by port | Build one panel over a library data interface (`useProgramData().library` vs root hooks); delete the forked `schedule-*` files. The FRC panel is the reference. | L |

### C. Data-port UI forks (rendering follows `!port`)
| Page | Deviation | Cause | Fix | Size |
|---|---|---|---|---|
| Analytics > Match Scout (CSV import) | `PortPreview` (own alert, copy, "Nothing was imported" text) vs FRC's preview and error list. Also FTC gates import to admins. | `import-csv-dialog.tsx:185-195` | Single preview component fed by a plan object from either engine. The permission difference is data, keep it. | M |
| Team Management (join requests) | Same panel, but different error copy and the email line differs (`port ? ... : reason`). | `join-requests-panel.tsx:82,119` | Unify the strings; keep the data source switch | S |
| Account setup / no team | FTC renders `ProgramGate` + `TeamSetup`; FRC renders `TeamEnrollmentScreen` in a different wrapper. CLAUDE.md says ONE `team-setup-card`. Verify whether the screens match; likely drift in wrapper and `ProgramSwitcher` placement. | `[program]/layout.tsx:63-70` | Confirm, then render the same wrapper | S |

### D. Pages FTC does not have yet (unported, not "truly absent in FTC")
| Page | Deviation | Cause | Fix | Size |
|---|---|---|---|---|
| Sidebar | `FTC_UNAVAILABLE_PATHS` entries are shown GREYED OUT with a tooltip. Your rule says hidden, not greyed. The analytics tab strip already hides them, so the two navs disagree. | `lib/sidebar/resolve.ts:78`, `components/layout/sidebar.tsx:56` | Hide in the sidebar and drawer too (resolver filter). Config stays the same. | S |
| Any unconnected path (/changelog, /team-settings, /judge-book, /events/[eventKey], analytics: accuracy-compare, accuracy-verification, match-prediction, performance-reliability, robot-radar) | `UnconnectedPage` ("Not available in FTC yet") instead of the page. | `connection.paths` | Not a rendering fork. These need data ports (each one L). Out of scope for "no new features"; list only. | L each |
| Admin Panel tabs | FTC lacks Forms, Sessions, Rescore, Backups, Templates, platform tabs. | `config/programs/ftc.ts` `admin.tabs` | Unported, not an FTC-only gap. Out of scope (new feature). | L each |
| Dashboard / Event / Scout | Live, lobby, sub-ins, announcements are hidden by flags (handlers omitted, no dead tile). | `connection.features` | Already correct (hidden, not greyed). No change. | none |

### E. Slot count (2 vs 3)
No hardcoded 3-slot assumption found in shared rendering. `schedule-grid`, practice and live results compute columns from data
(`COMPARISON_COLUMNS` covers 3 to 5 and falls back, check the 2-robot case). `profile-sections.tsx:310` `[0,1,2]` is a skeleton
placeholder only. Gap: **no test renders 2 slots in practice results or the schedule grid** (Phase 2 adds them).

### F. FRC issues seen (NOT fixing without your OK)
1. `scout-status/page.tsx:149` uses a raw `<select>` with a hardcoded `bg-[#1b1b26]` color (violates the token rule); shared by both programs.
2. `DifficultySelect` Live tile copy says "livestreamed FRC match" (FRC name outside a program file; only shown for FRC).
3. `COMPARISON_COLUMNS` in `results-screen.tsx` and `live-results-screen.tsx` is duplicated; neither has a 2-column entry.

## Proposed order (one fix clears several pages)
1. A (practice): S + M, one PR, clears 5 rows.
2. D sidebar hide: S, clears every greyed row.
3. C: CSV preview, join requests strings, team-setup wrapper.
4. B: Match Library merge (L), last and optionally split.

## Questions for you
- "Any difficulty" and the event filter: give them to FRC as well, or hide them for FTC? (Default if no answer: FRC gets the event filter and "Any difficulty" is accepted as an FTC-only data difference.)
- Is B (L) in scope for this pass, or deferred?

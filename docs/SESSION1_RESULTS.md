# Session 1: quick UI fixes (results)

Branch `rebuild`. Display and layout only: no rules, schema, data writes or deploys.

## What changed
1. **All programs button**: removed from `ProgramSwitcher` (sidebar, mobile drawer, dashboard header, setup frame). It was never in `lib/nav.ts`, so the Session F registry is untouched. The pills still switch program; the mobile top bar `ProgramChip` keeps the `/?choose=1` link.
2. **Year on event names**: `eventYearLabel` / `withEventYear` / `eventTitle` in `lib/events/names.ts`; `EventNameState.displayName` is set in the name chain (`name-store.ts` `resolve`). `name` stays raw, so `selectedEventNames`, `currentEventName`, CSV and backup exports are unchanged. Key shape gives the season (`2026lake` -> 2026, `2025-USCALAB` -> 2025-26); no season, or a name that already states it, shows no extra year. Select triggers ellipsize; names carry a `title`.
3. **Landing**: program cards sit first (visible at 360x640). `components/marketing/auth-actions.tsx`: signed in shows Open dashboard (last-used program), loading shows a placeholder, signed out is unchanged. Login/signup cross-links hide when signed in.
4. **Long dropdowns**: shared `Select` capped to `--radix-select-content-available-height`, list scrolls inside, `overscroll-contain`, `touch-pan-y`. `FloatingPanel` caps to the room on its side (`computePanelPosition` returns `maxHeight`).
5. **Table / Summary**: `TabsTrigger` content is one `inline-flex` row; `pointer-coarse:min-h-11`; the stray `outline-none` is gone so the focus ring shows. Only Table / Summary uses an icon in a tab.
6. **Sign out**: `components/auth/sign-out-button.tsx`, rendered by `ProgramSetupFrame` and by the standalone `TeamEnrollmentScreen` shell (create, join, request sent, waiting, application). It calls `useAuth().logout`, so the theme reset still runs. `TeamSetupCard`'s own "Log out" line was removed (no duplicate).
7. **Footer**: existing `SiteFooter` rewritten; text, teams and URL in `config/platform.ts`; brand guard allowlists that one file. It is plain end-of-content, safe-area padded, and the year is `suppressHydrationWarning`.

## Left alone
- Event names kept raw on purpose: `practice-scouting` match payload, `eventNameOf` (feeds rescout records), CSV/backup, `eventLabel`.
- Native `<select>` (11 files) are drawn and scrolled by the OS. Radix `Select` and `FloatingPanel` are the only custom lists.
- `NoAccessScreen` lives inside the shell (sidebar Log out plus a dashboard link), so it is not a dead end.
- Footer no longer links Credits, Changelog, Privacy, Terms (spec: nothing else). Credits and Changelog stay in the sidebar; Privacy and Terms are still linked from login and signup only.

## FRC vs FTC
One page and one component set for both; no program-id comparisons added. No FRC bug found.

## Verify
`npm run lint`: 0 errors, 1 warning (unused `timeZone`, `match-list-screen.tsx:291`, not from this session). `npm test`: 272 files, 3578 tests pass. `npm run build`: passes. No browser or e2e run (not run here); no Playwright for the dropdown scroll.

## Manual check
1. Active Events, Analytics, Assignments, Match List: year on every event.
2. Signed out at 360px: FRC and FTC cards visible with no scroll.
3. Signed in: no Log in or Sign up on any marketing page.
4. Admin Panel > Sidebar icon picker and Page Access member picker: scroll on desktop and phone.
5. Analytics: Table and Summary icon beside text.
6. Team setup: Sign out.
7. Footer text and link on several pages, including the scout form's sticky bar.
8. Same pages side by side in /frc and /ftc.

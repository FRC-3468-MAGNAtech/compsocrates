# Session B results: global UI bugs

Verify: lint 0 errors / 0 warnings; `npm test` 185 files, 2809 tests passed (run before the last two small edits to `floating-panel.tsx` and `theme-provider.tsx`; not re-run); `npm run build` passed. No unrelated failures. Not checked in a real browser (see the manual checks).

## 1. Dropdown shift and stacking (items 1 and 2)
- Cause of the shift: Radix scroll lock (Select, Dialog) writes `body[data-scroll-locked]{overflow:hidden; position:relative; margin-right}` with `!important`. With the global `overflow-x: clip` that restyles `<body>`, so the sticky sidebar and top bar jump. Fix: `html body[data-scroll-locked]` override in `app/globals.css`. The library still blocks wheel and touch scroll behind the layer.
- Cause of "behind the sheet": the Analytics event menu was `absolute z-50` inside a `backdrop-filter` glass panel (its own stacking context), under the table's sticky `z-30/40`. Same flaw in `info-tip`, `hover-tip`, `accuracy-cell`, pick-list `column-settings`.
- New shared `components/ui/floating-panel.tsx` (portal to root or fullscreen element, `fixed`, clamped and flipped by `lib/floating-position.ts`, with the stacking-rule comment). All five above now use it.
- z-index scale in `app/globals.css`: `--z-raised 10 < topbar 20 < sidebar 30 < sheet 40 < dialog 50 < toast 55 < popover 60`. Applied to dialog, select, sidebar, mobile nav, top bar, toasts, notes sheet, droplet (glass-layer slider) and connection chip. Popover is above dialog on purpose (selects open inside dialogs). Toasts moved from 50 to 55, so they now show over dialogs.
- Page-local sticky z-indexes (tables, pick board, scout bars) left as is.

## 2. Scroll to top
- Window is the scroller; `Link` and router wrappers do not drop scroll. Next only scrolls when the new segment's top is off screen.
- `components/layout/scroll-to-top.tsx` (root layout) + `lib/scroll-reset.ts`: reset when the full pathname changes (program or event segment included), instant (also covers reduced motion). Skipped for Back/Forward (popstate), hash URLs, and query-only changes. Tests: `lib/scroll-reset.test.ts`.

## 3. Table / Summary buttons
- Cause: `TabsList className="h-10"` clamped 44px touch triggers. Fix in shared `components/ui/tabs.tsx`: no fixed height, `p-1.5`, trigger `px-5 min-h-10 whitespace-nowrap`. Removed fixed `h-10` (form analytics) and `h-11` (`filter-bar`).
- Every `Tabs` in the app gets the roomier padding: analytics form views and filter bar, event, match list, match breakdown, assignments, admin, dashboard role switcher, pick board, form builder, judge book, page access, scout stats, team setup, templates.

## 4. Sign-out theme reset
- Storage today: `users/{uid}` fields `themeId`, `colorMode`, `gradientIntensity`, `glassLayerLevel` are the source of truth. localStorage mirrors (`theme`, `colorMode`, `gradientIntensity`, `glass-shade`, via `storageKey`) are read by the pre-paint script in `<head>`. Only non-default values are stored. Signed out, the same keys hold a device-only choice.
- New `lib/account-appearance.ts`: marker key `appearanceOwner` = uid while signed in (marks the mirrors as account-derived). On sign-out, or on a cold load with nobody signed in but a marker left over (expired or revoked session), `ThemeProvider` clears mirrors and marker and renders defaults. `GlassLayerProvider` resets on the `appearance-reset` event. Firestore is untouched, so the theme returns on sign-in. Other tab: Firebase Auth shares the session so it resets itself; a `storage` listener re-sets the marker if the tab is still signed in.
- Known gap: a hard refresh on the login page after a session ended without sign-out can show the old theme until auth settles.
- For the later account-wide vs device toggle: split the mirrors into account keys and device keys; the owner marker is the seam.

Next step: run the 6 manual browser checks; then the later session that adds the account-wide vs device-only theme toggle.

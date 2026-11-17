# Mobile audit

**Read this first: what this audit is and is not.** It was a **static, code-level audit**. The environment had no browser: no Playwright, no Lighthouse, no device emulation. Every route and component was reviewed in the source, everything found was fixed in code and guarded with tests (`lib/mobile.test.ts`), but **nothing below was seen on a screen**, there are **no screenshots** and there are **no Lighthouse numbers**. `scripts/mobile-audit.mjs` is a ready-to-run Playwright script that produces the screenshots and fails on any horizontal scroll; running it (and Lighthouse) is the remaining step to close the checklist. See "Still to verify on a real device".

## Method

1. Listed every route (the production build's route table): the app shell pages, all Analytics subpages, Admin Panel tabs, Practice Scouting (solo, live, lobby), Changelog, Credits, Account and the marketing pages.
2. Searched the source for the patterns that break on phones: viewport units, fixed widths over 360px, wide grids with no responsive prefix, fixed or sticky bars without safe-area padding, small hit targets, form text under 16px, hover-only affordances, heavy `backdrop-filter` and filter stacks.
3. Read the scouting-critical screens (Match Scout Form, solo, lobby and live session screens, Pick List) for one-handed use, sticky bars and keyboard handling.

## Findings and fixes

| Area | Problem found | Fix |
|---|---|---|
| Whole site | No guard against the page scrolling sideways | `html, body { overflow-x: clip }` (clip, so sticky still works); wide containers keep scrolling inside themselves with momentum and no scroll-chaining (`.overflow-x-auto`) |
| Touch targets | Buttons, selects and inputs 28-40px tall (for example `h-8` buttons, the 36px top-bar buttons, the 28px video-collapse toggle) | On coarse pointers every `button`, `select`, `summary` and text input is at least 44px tall, icon-only buttons 44px wide; small Radix checkboxes, switches and radios keep their look and get a 10px invisible hit-area expansion instead of growing; the top-bar menu button is 44px; `.touch-compact` opts a control out |
| Hover-only | Tooltips via `HoverTip` | Already tap-to-pin and keyboard-focus (verified in source); no hover-only interactions found |
| Forms | Inputs at 14px (`text-sm`): iOS Safari zooms the page on focus | Form text is 16px on screens under 1024px (an unlayered rule, so it beats the utility class) |
| Number entry | Match and team picker number boxes | `inputMode="numeric"` |
| Modals | Centered 480-700px dialogs can overflow with the keyboard open | `DialogContent` is a **bottom sheet** under the `sm` breakpoint: full width, pinned to the bottom, rounded on top, at most 92% of the dynamic viewport (`dvh`), scrolls inside, safe-area padding below; the solid `glass-strong` and `glass-overlay` backing is unchanged. Selects and the droplet popover were already positioned from the trigger and clamped to the viewport |
| Viewport units | `100vh` (sidebar) and `min-h-screen` (marketing layout) jump when browser toolbars show or hide | `100dvh` / `min-h-dvh` |
| Safe areas | Sticky bottom bars (score bar, Next Robot and Cancel bars in solo, lobby and live sessions), the "match logged" toast, the sticky video, the phone top bar | `bottom-[max(0.75rem,env(safe-area-inset-bottom))]`, `top-[calc(env(safe-area-inset-top)+5rem)]`, top-bar top offset; the page draws under the notch (`viewport-fit=cover`) and the layout resizes with the on-screen keyboard (`interactiveWidget: resizes-content`) |
| Navigation | None | Already a slide-out drawer on phones (`Sidebar` mobile drawer plus `Topbar`), the same everywhere. The droplet button (glass slider plus offline and unsynced badge) is in **both** the drawer and the top bar, so it is reachable on a phone |
| Glass performance | `backdrop-filter` blur 20-32px on every panel plus three 60-70vw blurred, animated blobs: expensive on mobile GPUs | Under 768px: blur 12-16px, and the background blobs stop animating and lose their redundant blur filter (they are already radial gradients). `prefers-reduced-transparency`: solid panels, no blur. `prefers-reduced-motion`: CSS animations off and the blobs stop; Framer Motion honors it too (`MotionConfig reducedMotion="user"`) |
| Layout shift | None | Existing skeletons reserve space; Scout Status, Credits and Changelog use same-size skeletons. No change needed |
| Installable app | No manifest, no touch icon | `app/manifest.ts` (standalone display, theme and background colors from `config/brand.ts`) and `appleWebApp` metadata exist. **The only logo artwork is the favicon**, so the manifest lists **no icons** and there is no Apple touch icon. Chrome offers "install" only with a 192px and a 512px PNG, and iOS needs a 180px touch icon; set those slots in `config/brand.ts` once official artwork exists (`docs/REMAINING.md`, "Needs official artwork"). The manifest registers no service worker, so the Firebase Messaging worker at `/firebase-messaging-sw.js` is unaffected |
| iPhone push | The "add to Home Screen" hint existed only inline on one screen | `components/ui/add-to-home-screen-hint.tsx`, shown only in an iPhone or iPad browser tab (never in the installed app, on Android or on desktop); used where notifications are offered |

### Per area (reviewed in source)

- **Match Scout Form** (`components/scout`): large counter, toggle and tile controls; the sticky score bar clears the home indicator; numeric keypad on the pickers; two-column layouts collapse to one on phones. Landscape: the side-panel layout is `lg:`-gated, so a landscape phone gets the single-column form.
- **Practice session, lobby and live**: the video is sticky and collapsible on phones and clears the notch; the sticky Next Robot and Cancel bar clears the home indicator; the break menu and results screens are dialogs, so bottom sheets. The lobby and live screens use the same patterns.
- **Pick List**: Available and Picked tabs with button-based moves, drag with mouse, **touch long-press** and keyboard. No change.
- **Tables** (Match Analytics, Team Averages, Rankings, Scout Status): each scrolls horizontally inside its own container; only Scout Status has a sticky first column. **Not done:** sticky first columns on the other tables, and a card view for tables that are still cramped on a 360px phone. Worth deciding after seeing them on a device (see below).
- **Match Breakdown, Team Breakdown, Team Profile, Dashboards**: single-column stacking below `sm` and `lg`; the only grids with 3 or more columns and no responsive prefix are two Dashboard widget stat strips (Judge and Team Coach, 3 short numbers each) and the Pick List stats row (5-6 tiny columns); the latter is the one most likely to look cramped at 360px.
- **Admin Panel**: tables scroll in their own containers; the manual-match fast-entry row scrolls horizontally (`min-w-max`); all its dialogs become bottom sheets.

## Still to verify on a real device (not done)

1. **Run `scripts/mobile-audit.mjs`** (instructions in its header): screenshots at 360x640, 390x844, 430x932, 768x1024 and 844x390 landscape in Chromium and WebKit, and it fails on any horizontal page scroll. Attach the screenshots here.
2. **Lighthouse mobile** for `/`, `/login`, `/dashboard`, `/scout` and `/analytics/match-scout` (for example `npx lighthouse http://localhost:3000/dashboard --form-factor=mobile --only-categories=performance`). No performance budget was measured, so none is claimed. The likely biggest costs are the blur layers (reduced above), the shared Analytics realtime data layer and the event-data proxy calls. There is no chart library to lazy-load (charts are plain SVG).
3. The 44px rule is a global CSS floor: check for any place it makes a dense control look oversized (opt out with `.touch-compact`).
4. Confirm the bottom-sheet dialogs with the iOS keyboard open (`interactiveWidget` is Chromium-only; Safari keeps the layout viewport, so a tall sheet scrolls inside itself instead).
5. After the icon artwork is in, install to an iPhone Home Screen and an Android phone, and confirm the install prompt appears and push registration works from the installed app.

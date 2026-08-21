# CompSocrates v2 Architecture Manual

CompSocrates v2 is a light-mode Greek-Tech scouting and strategy platform for competition robotics teams. The `CompSocrates-v2` branch treats the previous app as a feature and data specification while rebuilding the interaction model around a floating HUD, asymmetrical strategy decks, and high-translucency glass surfaces.

## Architecture Principles

- `preview` logic is the functional blueprint for scoring, filters, role checks, event detection, Firestore queries, and analytics calculations.
- UI structure is rebuilt with modular React components instead of legacy layout trees, sidebar rails, or old dashboard wrapper patterns.
- The visual system is fixed to MAGNATech Greek-Tech: slate/pearl canvas, crimson actions, metallic gold accents, extreme frosted glass, and persistent radial glows that shine through interface layers.
- Data-heavy pages keep efficient local hooks and memoized transforms. Complex metrics remain in utility modules instead of being rewritten inside page components.
- Dead theming infrastructure was removed. The app now has one official design system and no dark/legacy theme fallback layer.

## Application Stack

- Next.js App Router under `app/`
- React client components for authenticated workflows and Firestore-backed screens
- Firebase Auth and Firestore for users, teams, scouting entries, assignments, events, and administrative state
- Tailwind CSS plus global design tokens in [app/globals.css](app/globals.css)
- Recharts and local analytics utilities for strategy visualizations
- Lucide React icons for controls and navigation

## Directory Structure

```text
app/
  api/                     Server routes for user, TBA, FIRST, Statbotics, and team operations
  analytics/               Analytics views using shared filtering and scoring utilities
  components/              Reusable UI, app chrome, chart, modal, and context components
  hooks/                   Focused client hooks such as scout accuracy loading
  scripts/                 One-off migration/import scripts
  utils/                   Data normalization, scoring, permissions, events, and integrations
  page.tsx                 Greek-Tech public entry screen
  layout.tsx               Auth provider, global shell host, cookie banner
  globals.css              Design tokens, glassmorphism layer, form/table compatibility styles
```

## Component Hierarchy

```text
RootLayout
  AuthProvider
    Page / ProtectedRoute
      Sidebar export rendering Floating HUD navigation
      Page content
    CookieConsentBanner

Analytics pages
  ProtectedRoute
    AnalyticsShell
      AnalyticsNotesProvider
      GreekTechBackground
      Floating HUD navigation
        GreekHeader
      Priority strategy deck
      Floating search/filter HUD
      Asymmetrical analytics deck frame
        Analytics page content

Public entry
  GreekTechBackground
    SectionShell
      GreekHeader
      GlassCard / StatBadge / PillButton
```

## Core UI Primitives

[app/components/GreekTech.tsx](app/components/GreekTech.tsx) defines the shared visual primitives:

- `GreekTechBackground`: slate/pearl canvas, subtle grid, large persistent crimson/gold ambient glows.
- `SectionShell`: responsive max-width layout wrapper.
- `GreekHeader`: Dalek-styled page title block with optional tactical badges/actions.
- `GlassCard`: high-translucency frosted container with top-edge sheen and crimson/gold edge tint.
- `GradientBorder`: gold-to-crimson border wrapper for emphasis panels.
- `StatBadge`: compact pill for numeric or state highlights.
- `PillButton`: rounded command button with primary, secondary, and ghost variants.
- `FloatingDeck`: elevated asymmetric panel used for priority metrics, matchup decks, and verification surfaces.
- `HudPill`: central floating command bar shell with heavy blur and translucent white fill.

These primitives are intentionally small. Pages compose them instead of carrying large bespoke layout blocks.

## Design Tokens

Global tokens live in `:root` inside [app/globals.css](app/globals.css):

- `--cs-crimson`: `#8B0000`
- `--cs-red`: `#DC2626`
- `--cs-gold`: `#D4AF37`
- `--cs-pearl`: `#F1F5F9`
- `--cs-marble`: `#E2E8F0`
- `--cs-ink`: `#0F172A`
- `--theme-font-heading`: Dalek local font fallback for `h1`, `h2`, and hero titles
- `--theme-font-body`: Inter/system sans for interface copy
- `--theme-font-data`: JetBrains Mono/monospace for dense analytics and tables

The global stylesheet also provides compatibility classes for existing analytics tables:

- `.table-scroll`
- `.sticky-header`
- `.sticky-left-*`
- `.theme-primary`
- `.theme-stepper-btn`

These are maintained because analytics pages rely on sticky columns and dense table behavior.

## Navigation Shell

[app/components/Sidebar.tsx](app/components/Sidebar.tsx) keeps its historical export name for compatibility, but it now renders the primary authenticated floating HUD. It:

- Loads team display context from Firestore.
- Uses `getDashboardRoute`, `getUserRoles`, `getRoleBadge`, and `canAccessForm` from preview-derived utilities.
- Gates form links by role and team-level form access overrides.
- Pins high-priority workspaces into a central pill command bar.
- Opens a searchable glass command palette for all available workspaces.
- Provides responsive mobile and desktop navigation without reserving a left rail.

The navigation does not own application data beyond the team label and access overrides needed to render links.

## Analytics Shell

[app/components/AnalyticsShell.tsx](app/components/AnalyticsShell.tsx) wraps every analytics view with a non-sidebar strategy surface. It owns shell-level controls only:

- Game selection for `CHARGED_UP`, `REEFSCAPE`, and `REBUILT`
- Event selection and practice-event remapping
- Practice-only toggle
- Page-wide search across table rows and searchable cards
- Analytics notes visibility
- Role-gated Scout Status link
- Priority deck links for Match Strategy, Scout Matrix, and Team Breakdown
- Support view pills for rankings, reliability, radar, pick lists, and reports

Analytics metric calculations remain in page files and `app/utils/*` modules, matching the preview branch behavior. The shell does not calculate scores.

## Data Flow

1. `AuthProvider` loads Firebase Auth state and user/team metadata.
2. `ProtectedRoute` enforces authentication, profile completion, team membership, role access, and form access overrides.
3. Page components fetch Firestore collections such as `scouting`, `pitScouting`, `teams`, `matchAssignments`, and practice data.
4. Utilities normalize event keys, match labels, game filters, role permissions, scoring, and scout accuracy.
5. Shared shells render navigation and filters, then pass page content through unchanged.

## Firestore Boundaries

UI components may read small display/access context when needed. Heavy domain reads remain inside route pages or utility modules:

- Team navigation label and form overrides: `Sidebar`
- Route authorization overrides: `ProtectedRoute`
- Analytics entries and scoring inputs: analytics page components
- TBA/FIRST/Statbotics integrations: `app/api/*` and integration utilities

## Removed Legacy Code

The legacy multi-theme subsystem was deleted:

- `app/components/ThemePicker.tsx`
- `app/components/ThemeInitializer.tsx`
- `app/utils/themes.ts`

The previous global CSS compatibility theme layer was replaced with fixed Greek-Tech tokens and focused form/table support.

## Maintenance Rules

- Keep new UI in reusable components under `app/components/`.
- Do not introduce alternate dark or legacy palettes.
- Do not copy old DOM layouts into new surfaces.
- Keep scoring and data normalization in utilities, not in presentation components.
- Keep comments sparse and useful.
- Remove dead imports, obsolete state, unused props, and replaced files in the same change that makes them obsolete.

## Verification

Before merging substantial UI changes:

```bash
npm run lint
npm run build
```

For visual work, run the Next dev server and inspect authenticated pages at desktop and mobile widths, with special attention to:

- Navigation overflow
- Analytics table stickiness
- Form control readability
- Mobile overlays
- Text fit inside pills, cards, tabs, and buttons

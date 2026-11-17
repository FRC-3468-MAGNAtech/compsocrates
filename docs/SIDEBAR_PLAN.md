# Sidebar customizer: plan (Session F, Phase 1)
> **Changed after review:** the builder is drag and drop (no up/down arrows) and the sidebar uses each page's plain label, never the game-prefixed form name. See `SESSION_F_RESULTS.md`.

Repo is `CompSocrates rebuild/`, branch `rebuild` (not main). Session E's helper exists, so no stop.

## 1. Current nav and who reads it
- `lib/nav.ts`: `NavItem {href, label, formType?, icon, matchPrefix?}`; `mainNav` (18), `secondaryNav` (5: Admin Panel, Changelog, Credits, Team Settings, Account), `analyticsNav` (Analytics tab strip, not the sidebar). **No stable id on items** (href is the only key).
- Readers of `mainNav`/`secondaryNav`: `components/layout/sidebar.tsx` (one `SidebarInner`, mounted twice: desktop aside and mobile drawer), `components/page-access/parts.tsx:133` (Page Access "what they see" list), `lib/page-access/access.test.ts`. `analyticsNav`: `analytics-tabs.tsx`, a test.
- Not readers: Topbar (only opens the drawer), no command palette, no breadcrumbs. The layout mounts `<Sidebar>` once (`app/(app)/[program]/layout.tsx`).
- Extras rendered in the sidebar: changelog unread dot, platform-owner pending-applications badge on Admin, FTC greyed entries (`isUnavailableInProgram`, 6 paths), collapse-to-icons (desktop).

## 2. Gating (customization can never grant access)
- Role / page access: `visibleNav(items, can)` -> `pageForPath(href)` -> `canAccessPage` (lib/page-access). Same check as the route guard.
- `/admin` also needs `profile.isAdmin`. Program: greyed (not hidden) via `unavailablePaths`. Feature flags: the sidebar does not gate by `connection.features/paths` (an unconnected FTC path shows `UnconnectedPage`); I keep that.
- **Sidebar visibility is cosmetic, not security.** Hiding a page does not block its route; showing one does not grant it. The route guard, page-access doc and Firestore rules stay as they are. The resolver applies the same `can` and admin checks AFTER the config, so a config can only rearrange or hide.

## 3. Storage and rules
- Existing per-team settings: `teams/{id}/settings/pageAccess`, FTC `programs/ftc/teams/{id}/settings/pageAccess` (via `programPath`). Same pattern for ours.
- Recommend one doc per team and program: `teams/{id}/settings/sidebar` and `programs/ftc/teams/{id}/settings/sidebar`. New doc, nothing migrated, no existing schema touched.
- Rules today: `settings/{docId}` read = `sameTeam` (all members; other teams cannot), write = `docId == 'pageAccess' && isAdmin() && valid...`. So read is already fine; **write needs a block** for `sidebar` in both the root and `ftc_` sections (admin only, shape and size validated, no delete). Written to `firestore.rules` only, not deployed; emulator tests added to `firestore.rules.test.ts` (admin ok, member no, other team no, other team cannot read). Java 21 is present.

## 4. Session E helper
Exported: `formDisplayName(game, formType, opts)` in `lib/forms/form-display-name.ts` (pure); hook `useFormDisplayNames(seasonId?)` and `useNavLabel()` (`components/layout/use-nav-label.ts`) follow the program's current game. **Conflict:** commit `ffa8ed3` deliberately kept the sidebar on static labels, noting `useNavLabel` was left "for the sidebar customizer". Your new requirement reverses that for sidebar form items only (Page Access stays static). I will follow your requirement.

## 5. Design
**Config** (`SidebarConfig`): `{ version: 1, rev: number, entries: Entry[], updatedBy, updatedAt }`. `Entry = { id, kind: "page"|"group", parent: null|"@footer"|groupId, order, label?, icon?, hidden? }`. Group entries carry a required label and icon, no route. Page id = new stable `id` on each `NavItem` (equals the page-access id where one exists; Team Settings gets its own). Never a label.
- Zones: `null` = main list, `"@footer"` = the bottom block after the divider, a group id = nested (one level enforced; deeper is cheap in the tree but I will cap at 1). Max 120 entries, label 40 chars.
- Icons: stored as a string key from a curated allowlist of lucide-react icons already imported in the app (`lib/sidebar/icons.ts`); unknown key falls back to the default icon. No new dependency.
**Resolver** `resolveSidebar({program, isAdmin, can, config, labelOf, pathname})` in `lib/sidebar/resolve.ts` (pure, tested). Output: zone trees with `{id, href, label, icon, unavailable, children, activeParent}`. Code list stays the truth: missing pages appended to the end of their default group or zone; unknown, unshowable or duplicate entries ignored; empty groups dropped; hidden flag honoured except Admin Panel for admins. **Lockout guard:** if the config leaves an admin without Admin Panel, or leaves any user with zero visible pages, the whole config is ignored (default layout).
**Default** (no config): today's list, except the 7 form pages (`/scout`, lead scout, match strategy, drive reflection, pit scout, team strategy, helper; all carry `formType`) move into group "Forms". Excluded, not forms: Practice Scouting (a session list/launcher), Analytics pages, Judge Book. The Admin "Forms" builder is an Admin tab, not a nav entry. Form labels come from `formDisplayName`; an admin label override wins.
**Sidebar**: `Sidebar` renders resolver output in both the desktop aside and the drawer (shared `SidebarInner`). Parent = `<button aria-expanded>`, children indented, active parent auto-expanded and highlighted, expanded state per device in localStorage (brand storage-key helper). 44px targets on coarse pointers. Greyed FTC pages stay greyed. Default or cached config renders on first paint; the live config swaps in from a `onSnapshot` subscription (provider next to `PageAccessProvider`); last good config cached per program+team; read errors fall back silently (reported, shown only in the customizer).
**Customizer**: new Admin tab "Sidebar" (`components/admin/sidebar-panel.tsx`, admin only like Page Access). Move up/down, indent/outdent, hide, rename, icon, group create/rename/delete, reset item, reset all; live preview via the same resolver; Save/Discard; save runs in a transaction comparing `rev` and shows a conflict message if it changed. Shared Switch, Select, Dialog, glass panel. Drag and drop skipped (buttons are the full interface).
**Other readers**: Page Access list (`parts.tsx`) reads a flat `NAV_PAGES` list from the same module, not the resolver, so customizing never changes who "can see" a page there.
**Additive**: new doc `settings/sidebar` (both programs), no new fields on existing docs, no audit-log action planned (decision for you below).

## Open decisions for you
1. Audit-log entry on save (as Page Access does)? Default: yes, `edit-sidebar`.
2. Team Settings, Admin etc. can be moved out of the footer zone: OK? Default yes.

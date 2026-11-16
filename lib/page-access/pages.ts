import type { RoleId } from "@/lib/roles";
import type { FormType } from "@/lib/forms/types";

// P26: the single registry of who may open which page. A new page declares its access HERE, once; the navigation,
// the route guard, the Admin Panel's Page Access screen and (for gated writes) firestore.rules' `pageAccessAllowed()` all
// follow it. Pure: no React, no Firebase.

/**
 *  - `open`: every role, not configurable.
 *  - `restricted`: configurable. The default roles below apply until an admin changes them (Admin Panel > Page Access).
 *  - `admin`: admins and the owner only, never grantable.
 * Admins and the owner can always open every page.
 */
export type PageAccessKind = "open" | "restricted" | "admin";

export type PageDef = {
  /** Stable id (stored in the page-access doc; never rename one). */
  id: string;
  title: string;
  /** Session E: set on the pages that are forms; they are shown as `formDisplayName(game, formType)` (`useNavLabel`). `title` stays the stored fallback. */
  formType?: FormType;
  /** The main route first. A path belongs to the page whose route is its longest match (a route matches itself and everything below it). */
  routes: string[];
  access: PageAccessKind;
  /** For `restricted` pages: the roles (primary OR secondary) that can open it until an admin changes it. Empty for open and admin pages. */
  defaultRoles: RoleId[];
};

export const PAGES: PageDef[] = [
  // --- open to every role ------------------------------------------------------------------------------------
  { id: "dashboard", title: "Dashboard", routes: ["/dashboard"], access: "open", defaultRoles: [] },
  { id: "match-scout-form", formType: "match-scout", title: "Match Scout Form", routes: ["/scout"], access: "open", defaultRoles: [] },
  // Every Analytics subpage except Scout Status (a longer route below wins for that one).
  { id: "analytics", title: "Analytics", routes: ["/analytics"], access: "open", defaultRoles: [] },
  { id: "practice-scouting", title: "Practice Scouting", routes: ["/practice-scouting"], access: "open", defaultRoles: [] },
  { id: "my-scouting", title: "My Scouting", routes: ["/my-scouting"], access: "open", defaultRoles: [] },
  { id: "people", title: "People", routes: ["/people", "/profile"], access: "open", defaultRoles: [] },
  { id: "changelog", title: "Changelog", routes: ["/changelog"], access: "open", defaultRoles: [] },
  { id: "credits", title: "Credits", routes: ["/credits"], access: "open", defaultRoles: [] },
  { id: "account-settings", title: "Account Settings", routes: ["/account"], access: "open", defaultRoles: [] },
  { id: "match-list", title: "Match List", routes: ["/match-list"], access: "open", defaultRoles: [] },
  // CS-only pages (docs/ROUTES.md). CS gated both with sign-in only. `/events/[eventKey]` is plural so it is not caught by the
  // restricted `/event` (Active Events) page above.
  { id: "event-details", title: "Event Details", routes: ["/events"], access: "open", defaultRoles: [] },
  { id: "judge-book", title: "Judge Book", routes: ["/judge-book"], access: "open", defaultRoles: [] },

  // --- restricted (configurable) -----------------------------------------------------------------------------
  { id: "lead-scout-form", formType: "lead-scout", title: "Lead Scout Form", routes: ["/lead-scout-form"], access: "restricted", defaultRoles: ["lead-scout"] },
  { id: "pit-scout-form", formType: "pit-scout", title: "Pit Scout Form", routes: ["/pit-scout-form"], access: "restricted", defaultRoles: ["pit-scout"] },
  { id: "team-strategy-form", formType: "team-strategy", title: "Team Strategy Form", routes: ["/team-strategy-form"], access: "restricted", defaultRoles: ["lead-strategist"] },
  { id: "match-strategy-form", formType: "match-strategy", title: "Match Strategy Form", routes: ["/match-strategy-form"], access: "restricted", defaultRoles: ["lead-strategist"] },
  { id: "drive-reflection-form", formType: "drive-reflection", title: "Drive Reflection Form", routes: ["/drive-reflection-form"], access: "restricted", defaultRoles: ["drive-team"] },
  { id: "helper-form", formType: "helper", title: "Helper Form", routes: ["/helper-form"], access: "restricted", defaultRoles: ["pit-scout", "pit-team"] },
  { id: "scout-status", title: "Scout Status", routes: ["/analytics/scout-status"], access: "restricted", defaultRoles: ["lead-scout", "team-coach"] },
  // CS gated both of these to team-coach (`canAccessForm("accuracy-verification")`); the longer routes win over the open `/analytics`.
  { id: "accuracy-verification", title: "Accuracy Verification", routes: ["/analytics/accuracy-verification", "/analytics/accuracy-compare"], access: "restricted", defaultRoles: ["team-coach"] },
  { id: "scout-accuracy", title: "Scout Accuracy", routes: ["/scout-accuracy"], access: "restricted", defaultRoles: ["lead-scout", "team-coach"] },
  { id: "assignments", title: "Assignments", routes: ["/assignments"], access: "restricted", defaultRoles: ["lead-scout"] },
  { id: "event-selection", title: "Event Selection", routes: ["/event"], access: "restricted", defaultRoles: ["lead-scout", "lead-strategist", "team-coach"] },
  { id: "team-management", title: "Team Management", routes: ["/team-management"], access: "restricted", defaultRoles: ["team-coach"] },

  // --- admin only (not grantable) ----------------------------------------------------------------------------
  // The whole Admin Panel: Forms, Page Access and the other tabs.
  { id: "admin-panel", title: "Admin Panel", routes: ["/admin"], access: "admin", defaultRoles: [] },
];

export const RESTRICTED_PAGES: PageDef[] = PAGES.filter((p) => p.access === "restricted");

/**
 * Session 6: open pages that can NEVER be closed to a role, with the one-line reason the Page Access screen shows. The Dashboard is every account's landing
 * page; the others are the personal pages an account with no team needs (docs/MEMBERSHIP_PLAN.md section 3), so they are not part of a team's page access.
 */
export const ALWAYS_ON_PAGES: Readonly<Record<string, string>> = {
  dashboard: "Everyone's landing page, so it can't be closed.",
  "practice-scouting": "Always available: a personal page, not part of the team's page access.",
  changelog: "Always available: a personal page, not part of the team's page access.",
  credits: "Always available: a personal page, not part of the team's page access.",
  "account-settings": "Always available: a personal page, not part of the team's page access.",
};
export const isAlwaysOnPage = (id: string): boolean => id in ALWAYS_ON_PAGES;

/** Open pages an admin may close to a role (stored as `openRestrictions`). */
export const RESTRICTABLE_OPEN_PAGES: PageDef[] = PAGES.filter((p) => p.access === "open" && !isAlwaysOnPage(p.id));
const RESTRICTABLE_IDS = new Set(RESTRICTABLE_OPEN_PAGES.map((p) => p.id));
export const isRestrictableOpenPage = (id: string): boolean => RESTRICTABLE_IDS.has(id);

/** Role ids that can never be restricted, whatever is stored (admins and owners are flags today; this keeps it true if either ever becomes a role id). */
export const NEVER_RESTRICTED_ROLES: readonly string[] = ["admin", "owner"];

const BY_ID = new Map(PAGES.map((p) => [p.id, p]));

export const getPage = (id: string): PageDef | null => BY_ID.get(id) ?? null;

const routeMatches = (route: string, pathname: string) => pathname === route || pathname.startsWith(`${route}/`);

/** The registered page a path belongs to (the longest matching route wins), or null for a path no page owns (the login screens, e2e fixtures, ...): those aren't gated. */
export function pageForPath(pathname: string): PageDef | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  let best: { page: PageDef; len: number } | null = null;
  for (const page of PAGES) {
    for (const route of page.routes) {
      if (routeMatches(route, path) && (!best || route.length > best.len)) best = { page, len: route.length };
    }
  }
  return best?.page ?? null;
}

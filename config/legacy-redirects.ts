/**
 * Old CompSocrates URLs -> their place in the rebuild (docs/ROUTES.md). Data only: `next.config.ts` turns it
 * into permanent redirects, and `legacy-redirects.test.ts` fails if a CS route is missing from it.
 * Changing a URL later means editing one row here.
 */

export type LegacyRedirect = {
  /** Old path. `:name` segments are forwarded to the destination. */
  from: string;
  /** New path (may carry a fixed query such as `?role=team-coach`). */
  to: string;
  /** Only redirect when this query parameter has this value (checked before the plain redirect of the same path). */
  whenQuery?: { key: string; value: string };
};

/** Redirects are ordered: a conditional row must come before the plain row for the same `from`. */
export const LEGACY_REDIRECTS: LegacyRedirect[] = [
  // Dashboards: nine role routes collapse to /dashboard?role=
  { from: "/match-scout-dashboard", to: "/dashboard?role=match-scout" },
  { from: "/scout-dashboard", to: "/dashboard?role=match-scout" },
  { from: "/pit-scout-dashboard", to: "/dashboard?role=pit-scout" },
  { from: "/pit-team-dashboard", to: "/dashboard?role=pit-team" },
  { from: "/drive-team-dashboard", to: "/dashboard?role=drive-team" },
  { from: "/lead-scout-dashboard", to: "/dashboard?role=lead-scout" },
  { from: "/lead-strategist-dashboard", to: "/dashboard?role=lead-strategist" },
  { from: "/coach-dashboard", to: "/dashboard?role=team-coach" },
  { from: "/team-coach-dashboard", to: "/dashboard?role=team-coach" },
  { from: "/media-dashboard", to: "/dashboard?role=media" },
  { from: "/judge-awards-dashboard", to: "/dashboard?role=judge-awards" },
  { from: "/dashboard-selector", to: "/dashboard" },
  { from: "/verify-email", to: "/dashboard" },

  // Events
  { from: "/event-selection", to: "/event" },
  { from: "/event-details", to: "/event" },
  { from: "/event-details/:eventKey", to: "/events/:eventKey" },

  // Forms
  { from: "/scout-form", to: "/lead-scout-form", whenQuery: { key: "lead", value: "1" } },
  { from: "/scout-form", to: "/scout" },
  { from: "/scout-form-reefscape", to: "/scout" },
  { from: "/scout-form-placeholder", to: "/scout" },
  { from: "/pit-scout-form-reefscape", to: "/pit-scout-form" },
  { from: "/pit-scout-form-placeholder", to: "/pit-scout-form" },
  { from: "/strategy-scout-form", to: "/team-strategy-form" },
  { from: "/drive-scout-form", to: "/drive-reflection-form" },
  { from: "/form-builder", to: "/admin" },

  // Analytics
  { from: "/analytics/lead", to: "/analytics/lead-scout" },
  { from: "/analytics/pit", to: "/analytics/pit-scout" },
  { from: "/analytics/team-breakdown/:teamNumber", to: "/analytics/teams/:teamNumber" },
  { from: "/pick-list", to: "/analytics/pick-list" },

  // People, admin, settings, release notes
  { from: "/profile/:userId", to: "/people/:userId" },
  { from: "/admin/match-scout-ids", to: "/admin" },
  { from: "/admin/practice-session-ids", to: "/admin" },
  { from: "/settings/api-keys", to: "/team-settings" },
  { from: "/version-releases", to: "/changelog" },
  { from: "/update-lot", to: "/changelog" },
];

/** CS routes whose URL is unchanged in the rebuild (the page exists at the same path). */
export const KEPT_ROUTES: string[] = [
  "/",
  "/login",
  "/signup",
  "/privacy-policy",
  "/terms-of-service",
  "/dashboard",
  "/match-list",
  "/pit-scout-form",
  "/match-strategy-form",
  "/helper-form",
  "/practice-scouting",
  "/scout-accuracy",
  "/assignments",
  "/team-management",
  "/people",
  "/account",
  "/admin",
  "/changelog",
  "/judge-book",
  "/judge-book/:cardId",
  "/analytics/drive-reflection",
  "/analytics/helper",
  "/analytics/match-breakdown",
  "/analytics/match-strategy",
  "/analytics/rankings",
  "/analytics/scout-status",
  "/analytics/team-averages",
  "/analytics/team-breakdown",
  "/analytics/team-strategy",
  "/analytics/pick-list",
  "/analytics/match-prediction",
  "/analytics/performance-reliability",
  "/analytics/robot-radar",
  "/analytics/accuracy-compare",
  "/analytics/accuracy-verification",
];

/** CS routes that never worked, so no one can have linked to them. They get no redirect. */
export const UNREACHABLE_ROUTES: { path: string; reason: string }[] = [
  { path: "/profile-[userId]", reason: "The folder name is not a dynamic segment; the URL would be the literal text `/profile-[userId]`." },
];

/**
 * Every `page.tsx` route in the CS app (CompSocrates (reference)/app), written as URL paths.
 * `/analytics` itself is redirected by the page `app/(app)/analytics/page.tsx` (the app already does this),
 * so it is listed in KEPT_ROUTES-equivalent form below via PAGE_REDIRECTS.
 */
export const CS_ROUTE_INVENTORY: string[] = [
  "/",
  "/account",
  "/admin",
  "/admin/match-scout-ids",
  "/admin/practice-session-ids",
  "/analytics",
  "/analytics/accuracy-compare",
  "/analytics/accuracy-verification",
  "/analytics/drive-reflection",
  "/analytics/helper",
  "/analytics/lead",
  "/analytics/match-breakdown",
  "/analytics/match-prediction",
  "/analytics/match-strategy",
  "/analytics/performance-reliability",
  "/analytics/pick-list",
  "/analytics/pit",
  "/analytics/rankings",
  "/analytics/robot-radar",
  "/analytics/scout-status",
  "/analytics/team-averages",
  "/analytics/team-breakdown",
  "/analytics/team-breakdown/:teamNumber",
  "/analytics/team-strategy",
  "/assignments",
  "/changelog",
  "/coach-dashboard",
  "/dashboard",
  "/dashboard-selector",
  "/drive-scout-form",
  "/drive-team-dashboard",
  "/event-details",
  "/event-details/:eventKey",
  "/event-selection",
  "/form-builder",
  "/helper-form",
  "/judge-awards-dashboard",
  "/judge-book",
  "/judge-book/:cardId",
  "/lead-scout-dashboard",
  "/lead-strategist-dashboard",
  "/login",
  "/match-list",
  "/match-scout-dashboard",
  "/match-strategy-form",
  "/media-dashboard",
  "/people",
  "/pick-list",
  "/pit-scout-dashboard",
  "/pit-scout-form",
  "/pit-scout-form-placeholder",
  "/pit-scout-form-reefscape",
  "/pit-team-dashboard",
  "/practice-scouting",
  "/privacy-policy",
  "/profile/:userId",
  "/profile-[userId]",
  "/scout-accuracy",
  "/scout-dashboard",
  "/scout-form",
  "/scout-form-placeholder",
  "/scout-form-reefscape",
  "/settings/api-keys",
  "/signup",
  "/strategy-scout-form",
  "/team-coach-dashboard",
  "/team-management",
  "/terms-of-service",
  "/update-lot",
  "/verify-email",
  "/version-releases",
];

/** Old routes that the rebuild's own page redirects (not next.config), for completeness of the coverage test. */
export const PAGE_REDIRECTS: string[] = ["/analytics"];

/**
 * Top-level segments of the signed-in app (`app/(app)/[program]/`). Every unprefixed URL under one of them was an FRC URL
 * (CS, and this app before programs) and redirects to `/frc/...`. `legacy-redirects.test.ts` fails if a segment is missing.
 */
export const APP_SEGMENTS: string[] = [
  "account", "admin", "analytics", "assignments", "changelog", "credits", "dashboard", "drive-reflection-form", "event", "events",
  "helper-form", "judge-book", "lead-scout-form", "match-list", "match-strategy-form", "my-scouting", "people", "pit-scout-form",
  "practice-scouting", "profile", "scout", "scout-accuracy", "team-management", "team-settings", "team-strategy-form",
];

/** The program every old URL belongs to. */
const LEGACY_PROGRAM = "frc";

/** Convert the table into Next's `redirects()` shape: old CS URLs first (to their `/frc` page), then every unprefixed app URL. */
export function toNextRedirects() {
  const legacy = LEGACY_REDIRECTS.map((r) => ({
    source: r.from,
    destination: `/${LEGACY_PROGRAM}${r.to}`,
    permanent: true,
    ...(r.whenQuery ? { has: [{ type: "query" as const, key: r.whenQuery.key, value: r.whenQuery.value }] } : {}),
  }));
  const unprefixed = APP_SEGMENTS.flatMap((seg) => [
    { source: `/${seg}`, destination: `/${LEGACY_PROGRAM}/${seg}`, permanent: true },
    { source: `/${seg}/:path*`, destination: `/${LEGACY_PROGRAM}/${seg}/:path*`, permanent: true },
  ]);
  return [...legacy, ...unprefixed];
}

import type { ProgramFeatures } from "@/config/programs/types";
import { ROLES, type RoleId } from "@/lib/roles";

// Which realtime data each role's dashboard needs, and which role to show
// (P13). Pure. The dashboard's shared provider subscribes only to the union of
// what the *role being viewed* (plus the admin strip) needs, so a Pit Scout's
// dashboard doesn't pay for the Lead Scout's roster and session listeners.
//
// Always loaded, whatever the role: the team's scout entries and the FIRST API
// data for the selected event (matches, rankings, teams) — both are cheap,
// shared, and every role's header strip uses the latter.

/**
 * Which of a program's data features each optional dashboard source needs; a source whose feature is off is not read (and its cards show their empty states).
 * The sources that read the team's own roster, entries and forms need no feature.
 */
export const SOURCE_FEATURE: Partial<Record<DashboardSource, keyof ProgramFeatures>> = {
  sessions: "practice",
  library: "library",
  assignments: "assignments",
  teamAssignments: "assignments",
  pickList: "pickList",
};

/** The sources a program can serve, of the ones a role asks for. */
export function connectedSources(needs: ReadonlySet<DashboardSource>, features: ProgramFeatures): Set<DashboardSource> {
  return new Set([...needs].filter((source) => {
    const feature = SOURCE_FEATURE[source];
    return feature === undefined || features[feature];
  }));
}

export type DashboardSource =
  /** `users` for the team — scout names and the accuracy leaderboard. */
  | "members"
  /** Every practice/live/lobby session — Resume banner, pending robots, recent practice, flagged-session count. */
  | "sessions"
  /** The imported match library — labels for practice sessions. */
  | "library"
  /** `eventAttendance` for the team. */
  | "attendance"
  /** The selected event's published scouting schedule. */
  | "assignments"
  /** The selected event's shared pick list. */
  | "pickList"
  /** P29: the event's form entries (Pit Scout, Team Strategy, Helper ...) for the coverage widgets. */
  | "formEntries"
  /** P31: the Pit Scouting and Team Strategy assignments (the team's docs; the widget picks the selected event's). */
  | "teamAssignments";

export const ROLE_SOURCES: Record<RoleId, DashboardSource[]> = {
  "match-scout": ["members", "sessions", "library", "assignments"],
  "pit-scout": ["formEntries", "teamAssignments"],
  "pit-team": ["formEntries"],
  "drive-team": [],
  "lead-scout": ["members", "sessions", "attendance", "assignments"],
  "lead-strategist": ["pickList", "formEntries", "teamAssignments"],
  "team-coach": ["members", "sessions", "attendance"],
  media: [],
  "judge-awards": [],
};

/** The admin strip's flagged-practice-session count reads sessions, so admins always need them. */
const ADMIN_SOURCES: DashboardSource[] = ["sessions"];

export function sourcesFor(role: RoleId, isAdmin: boolean): Set<DashboardSource> {
  return new Set<DashboardSource>([...ROLE_SOURCES[role], ...(isAdmin ? ADMIN_SOURCES : [])]);
}

const ROLE_IDS = new Set<string>(ROLES.map((r) => r.id));
export const isRoleId = (value: unknown): value is RoleId => typeof value === "string" && ROLE_IDS.has(value);

/** The user's own roles, primary first, without duplicates. */
export function userRoles(primaryRole: RoleId, secondaryRoles: RoleId[]): RoleId[] {
  return [...new Set<RoleId>([primaryRole, ...secondaryRoles.filter(isRoleId)])];
}

/**
 * A `?role=` link (the old CompSocrates role-dashboard URLs redirect to `/dashboard?role=<id>`, config/legacy-redirects.ts).
 * A role the user holds simply selects it; any other valid role is an admin-only preview (the "View as role" path), and
 * for a non-admin it is ignored. Garbage and missing values are ignored.
 */
export function roleFromLink(
  param: string | null | undefined,
  input: { primaryRole: RoleId; secondaryRoles: RoleId[]; isAdmin: boolean }
): { own: RoleId | null; preview: RoleId | null } {
  if (!isRoleId(param)) return { own: null, preview: null };
  if (userRoles(input.primaryRole, input.secondaryRoles).includes(param)) return { own: param, preview: null };
  return { own: null, preview: input.isAdmin ? param : null };
}

/**
 * The role whose widgets to show: an admin's "View as role" preview if one is
 * set; otherwise the user's last choice among *their own* roles; otherwise
 * their primary role. A remembered role they no longer hold is ignored.
 */
export function resolveViewRole(input: { primaryRole: RoleId; secondaryRoles: RoleId[]; saved: string | null; viewAs: RoleId | null }): RoleId {
  if (input.viewAs && isRoleId(input.viewAs)) return input.viewAs;
  const mine = userRoles(input.primaryRole, input.secondaryRoles);
  return input.saved && isRoleId(input.saved) && mine.includes(input.saved) ? input.saved : input.primaryRole;
}

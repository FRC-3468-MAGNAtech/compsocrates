import { PROGRAMS } from "../../config/programs";

// Which collections the export covers. Program prefixes come from the program config (`firestorePrefix`), never from a literal. The names are the
// root collections in firestore.rules and the code; a collection that exists but is not listed here is found by the root listing and exported too
// (and reported), so a new collection is never silently left out. Subcollections cannot be listed without reading documents, so only the known ones
// below are exported; a subcollection added later must be added here.

export const ROOT_NAMES = [
  "users", "teams", "teamJoinRequests", "practiceMatches", "scouting", "leadScouting", "practiceSessions", "pitScouting", "matchAssignments",
  "pitAssignments", "practiceAssignments", "strategyScouting", "matchStrategyPlans", "driveScouting", "helperReports", "formPresets",
  "accuracyRescouts", "scoutingFlagStates", "teamAnnouncements", "subInRequests", "judgeBookCards", "versionReleases", "profiles", "appSettings",
  "rateLimits", "teamTransfers", "teamApplications", "applicationPrivate", "applicationBlocks", "platformAuditLog", "libraryMatches",
  "libraryEvents", "eventAttendance", "auditLog", "formEntries", "forms", "formTemplates", "pickLists", "changelog", "credits", "scoutTargets",
  "assignments", "liveMatches", "notifications", "lobbies", "scoutEntries", "platformChangelog", "platformCredits",
] as const;

/** parent collection name -> its subcollection names (the same names under every program prefix). */
export const SUBCOLLECTIONS: Readonly<Record<string, readonly string[]>> = {
  teams: ["settings", "pageAccessRequests", "joinRequests"],
  forms: ["versions"],
  formTemplates: ["updates", "reports", "imports"],
  liveMatches: ["scouts"],
  lobbies: ["players"],
};

export type PlanItem = {
  /** The collection path, or for a subcollection the pattern `<parent path>/<name>` (the documents' own paths are in each line). */
  path: string;
  /** Set for a subcollection: the plan path of its parent collection and its name. */
  parent?: string;
  sub?: string;
};

/** A prefix like "a/b/" as the path of the document that holds the program's collections ("a/b"); null for the root program. */
export function prefixDocPath(prefix: string): string | null {
  const p = prefix.replace(/\/+$/, "");
  return p ? p : null;
}

export function programPrefixes(): string[] {
  return Object.values(PROGRAMS).map((p) => p.firestorePrefix);
}

/** Root collections that only hold the programs' namespaces (the first segment of every non-empty prefix). */
function structuralRoots(prefixes: string[]): string[] {
  const out: string[] = [];
  for (const p of prefixes) {
    const first = p.split("/")[0];
    if (first && !out.includes(first)) out.push(first);
  }
  return out;
}

/** Every collection the export knows about, parents before their children. */
export function knownPlan(prefixes: string[] = programPrefixes()): PlanItem[] {
  const roots: PlanItem[] = [];
  for (const s of structuralRoots(prefixes)) roots.push({ path: s });
  for (const prefix of prefixes) for (const name of ROOT_NAMES) roots.push({ path: `${prefix}${name}` });
  const subs: PlanItem[] = [];
  for (const prefix of prefixes) {
    for (const [parent, names] of Object.entries(SUBCOLLECTIONS)) {
      for (const sub of names) subs.push({ path: `${prefix}${parent}/${sub}`, parent: `${prefix}${parent}`, sub });
    }
  }
  return [...roots, ...subs];
}

export type Discovery = { plan: PlanItem[]; unknown: string[]; missing: string[] };

/**
 * Narrows the known plan with what the listings found: `listed` maps a prefix ("" for the root) to the collection ids that exist there.
 * Known collections that do not exist are dropped (no read needed), listed ones that are not known are added and reported.
 */
export function applyDiscovery(known: PlanItem[], listed: Record<string, string[]>, prefixes: string[] = programPrefixes()): Discovery {
  const existing = new Set<string>();
  const unknown: string[] = [];
  const structural = structuralRoots(prefixes);
  for (const prefix of Object.keys(listed)) {
    for (const id of listed[prefix]) {
      existing.add(`${prefix}${id}`);
      const isKnown = (ROOT_NAMES as readonly string[]).includes(id) || (prefix === "" && structural.includes(id));
      if (!isKnown) unknown.push(`${prefix}${id}`);
    }
  }
  const roots = known.filter((i) => !i.parent && existing.has(i.path));
  const missing = known.filter((i) => !i.parent && !existing.has(i.path)).map((i) => i.path);
  const present = new Set(roots.map((i) => i.path));
  const subs = known.filter((i) => i.parent && present.has(i.parent));
  return { plan: [...roots, ...unknown.map((path) => ({ path })), ...subs], unknown, missing };
}

/** Limits the plan to the named paths. A name that matches nothing is an error. */
export function selectPlan(plan: PlanItem[], names: string[] | null): PlanItem[] {
  if (!names) return plan;
  const bad = names.filter((n) => !plan.some((i) => i.path === n));
  if (bad.length) throw new Error(`Not a known or existing collection path: ${bad.join(", ")}. Names are full paths, for example "teams" or "teams/settings" (a program's prefix comes first for its collections).`);
  return plan.filter((i) => names.includes(i.path));
}

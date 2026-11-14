/**
 * The program layer: one site, two FIRST programs. Everything that differs between them is a field of `ProgramConfig`,
 * so a component asks `useProgram()` instead of naming a program. Pure data, safe to import from client code.
 */

export const PROGRAM_IDS = ["frc", "ftc"] as const;
export type ProgramId = (typeof PROGRAM_IDS)[number];
export const DEFAULT_PROGRAM: ProgramId = "frc";

export function isProgramId(value: unknown): value is ProgramId {
  return typeof value === "string" && (PROGRAM_IDS as readonly string[]).includes(value);
}

export type ProgramBrand = {
  /** Short label for the selector and chips. */
  label: string;
  /** Full program name for copy. */
  fullName: string;
  tagline: string;
  description: string;
  /** Web app manifest and theme color. */
  themeColor: string;
};

export type ProgramEventRules = {
  allianceSize: number;
  /** "calendar": the season is the game's calendar year; "start-year": named for the year the season starts in. */
  seasonKind: "calendar" | "start-year";
  /** Does this program have EPA (Statbotics) data? */
  hasEpa: boolean;
};

/**
 * The data features of the shared app a program has wired up. A shell piece or page control whose feature is off does not mount (or is
 * hidden) for that program, so it never reads the other program's collections. Turning one on means giving it a program-aware data layer first.
 */
export type ProgramFeatures = {
  /** Scout assignments (the schedule), the assignment watcher and the "next assignment" prompt. */
  assignments: boolean;
  /** Sub-in requests (a scout hands a match to a teammate). */
  subIns: boolean;
  /** Practice sessions and the "scores ready" watcher. */
  practice: boolean;
  /** Live match presence. */
  live: boolean;
  /** The match library and its admin backfill. */
  library: boolean;
  /** Accuracy and flag recompute after a save (reads official results and rewrites entries). */
  accuracy: boolean;
  /** Importing scouting entries from a CSV file. */
  csvImport: boolean;
  /** The changelog and its unread dot. */
  changelog: boolean;
  /** Team applications (the platform owner's pending count). */
  applications: boolean;
  /** Event names and dates are looked up from the program's events API (placeholders on the team doc). Off: the team doc holds complete event records. */
  eventLookup: boolean;
};

export type ProgramConnection = {
  /** App paths (no program segment) whose data layer is connected. "all" for a program whose pages all are. Any other path shows the gate inside the shell. */
  paths: readonly string[] | "all";
  features: ProgramFeatures;
};

export type ProgramConfig = {
  id: ProgramId;
  brand: ProgramBrand;
  event: ProgramEventRules;
  /**
   * Firestore path prefix. `""` for FRC: its collections stay at the root, untouched. A namespaced prefix for the
   * other program: every program collection lives under it (see lib/firebase/paths.ts).
   */
  firestorePrefix: string;
  /** App paths (without the program segment) that exist only for another program and are shown greyed out here. */
  unavailablePaths: readonly string[];
  /**
   * Are the shared pages wired to this program's data? When false the signed-in shell shows the program gate instead of
   * the pages (they would otherwise read another program's collections).
   */
  pagesConnected: boolean;
  /** Which paths and data features of the shared app are connected (read when `pagesConnected`). */
  connection: ProgramConnection;
  /** May one account hold several teams and switch between them (lib/our-team.ts)? Off: one team per account, and no switcher is shown. */
  multiTeam: boolean;
};

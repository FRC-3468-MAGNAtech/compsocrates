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
};

import { FRC_PROGRAM } from "./frc";
import { FTC_PROGRAM } from "./ftc";
import type { ProgramConfig, ProgramId } from "./types";

export * from "./types";

export const PROGRAMS: Readonly<Record<ProgramId, ProgramConfig>> = { frc: FRC_PROGRAM, ftc: FTC_PROGRAM };

export function programConfig(id: ProgramId): ProgramConfig {
  return PROGRAMS[id];
}

/** Is `path` (no program segment, no query) a page whose data layer is connected for this program? */
export function isPathConnected(id: ProgramId, path: string): boolean {
  const { paths } = PROGRAMS[id].connection;
  return paths === "all" || paths.some((p) => path === p || path.startsWith(`${p}/`));
}

/** Is `path` (no program segment, no query) one of the pages this program does not have yet? */
export function isUnavailableInProgram(id: ProgramId, path: string): boolean {
  return PROGRAMS[id].unavailablePaths.some((p) => path === p || path.startsWith(`${p}/`));
}

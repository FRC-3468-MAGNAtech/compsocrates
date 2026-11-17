import { FRC_PROGRAM } from "./frc";
import { FTC_PROGRAM } from "./ftc";
import type { ProgramConfig, ProgramId } from "./types";

export * from "./types";

export const PROGRAMS: Readonly<Record<ProgramId, ProgramConfig>> = { frc: FRC_PROGRAM, ftc: FTC_PROGRAM };

export function programConfig(id: ProgramId): ProgramConfig {
  return PROGRAMS[id];
}

/** Does `path` equal `pattern` or sit under it? A `[param]` segment in the pattern matches any one segment (`/events/[eventKey]` matches `/events/2025casj`). */
function pathUnder(pattern: string, path: string): boolean {
  const want = pattern.split("/");
  const have = path.split("/");
  if (have.length < want.length) return false;
  return want.every((segment, i) => (segment.startsWith("[") && segment.endsWith("]") ? have[i] !== "" : segment === have[i]));
}

/** Is `path` (no program segment, no query) one of the pages this program does not have yet? */
export function isUnavailableInProgram(id: ProgramId, path: string): boolean {
  return PROGRAMS[id].unavailablePaths.some((p) => pathUnder(p, path));
}

/**
 * Is `path` (no program segment, no query) a page whose data layer is connected for this program? A page the program lists as unavailable is never
 * connected, even when a connected path above it (`/analytics`) would cover it by prefix.
 */
export function isPathConnected(id: ProgramId, path: string): boolean {
  const { paths } = PROGRAMS[id].connection;
  if (paths === "all") return true;
  return paths.some((p) => pathUnder(p, path)) && !isUnavailableInProgram(id, path);
}

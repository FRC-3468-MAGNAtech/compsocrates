import "server-only";
import { DEFAULT_PROGRAM, type ProgramId } from "@/config/programs/types";
import { liveProgramStore } from "@/lib/server/live-program";

/**
 * Problems with a program's event-data keys that the live-score routes cannot fix themselves, as plain messages naming the
 * variable. The poller skips a match whose schedule it cannot fetch (and logs why), so without this a missing key would
 * look like "no scores yet"; the routes return these as `warnings` so the caller (and the logs) can see it. The message
 * is the program's own store's (`LiveProgramStore.dataWarnings`), so this shared file names no program's variables.
 */
export function liveDataWarnings(program: ProgramId = DEFAULT_PROGRAM): string[] {
  return liveProgramStore(program).dataWarnings();
}

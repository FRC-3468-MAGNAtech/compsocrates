import type { PointTableGameDefinition } from "@/config/games/definition";
import { BIOBUZZ_CONFIG } from "@/config/games/ftc/biobuzz";

export { BIOBUZZ_CONFIG, BIOBUZZ_UNREALISTIC } from "@/config/games/ftc/biobuzz";

/**
 * The games of the FTC program. They are deliberately NOT part of the default program's `GAME_ID_LIST` / `GAME_DEFINITIONS` (`config/games/index.ts`),
 * so none of its season pickers, built-in forms, official templates or document matching can see them. This folder and `lib/ftc/games.ts` are where an
 * FTC game is named; the generic plugin and form generators in `lib/games/point-table.ts` and `lib/forms/game-form.ts` build from these entries.
 */
export const FTC_GAME_ID_LIST = ["BIOBUZZ"] as const;
export type FtcGameId = (typeof FTC_GAME_ID_LIST)[number];

/** One definition per FTC game. */
export const FTC_GAME_DEFINITIONS: Readonly<Record<FtcGameId, PointTableGameDefinition<FtcGameId>>> = {
  BIOBUZZ: BIOBUZZ_CONFIG,
};

/** The game new FTC entries are scouted for. */
export const CURRENT_FTC_GAME_ID: FtcGameId = "BIOBUZZ";

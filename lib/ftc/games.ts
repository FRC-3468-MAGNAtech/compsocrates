// The FTC program's game plugins and match forms, generated from `config/games/ftc/`. Pure (no Firebase, no React).
//
// This is the FTC counterpart of `lib/games/registry.ts` and the game half of `lib/forms/builtin.ts`: the default program's registry and built-in forms
// iterate its own game list, so nothing here is visible to them.

import { CURRENT_FTC_GAME_ID, FTC_GAME_DEFINITIONS, FTC_GAME_ID_LIST, type FtcGameId } from "@/config/games/ftc";
import type { PointTableGameDefinition } from "@/config/games/definition";
import { buildGameForm } from "@/lib/forms/game-form";
import type { Form } from "@/lib/forms/types";
import { PIT_BUILTIN_FORMS } from "@/lib/ftc/forms/pit-forms";
import { TEAM_BUILTIN_FORMS } from "@/lib/ftc/forms/team-forms";
import { createPointTablePlugin } from "@/lib/games/point-table";
import type { FullGamePlugin } from "@/lib/games/types";

export const FTC_GAME_IDS: readonly FtcGameId[] = FTC_GAME_ID_LIST;

export const isFtcGameId = (value: unknown): value is FtcGameId => typeof value === "string" && (FTC_GAME_IDS as readonly string[]).includes(value);

const PLUGINS = Object.fromEntries(FTC_GAME_ID_LIST.map((id) => [id, createPointTablePlugin(FTC_GAME_DEFINITIONS[id])])) as Record<FtcGameId, FullGamePlugin<FtcGameId>>;

export const getFtcGamePlugin = (id: FtcGameId): FullGamePlugin<FtcGameId> => PLUGINS[id];

export const listFtcGamePlugins = (): FullGamePlugin<FtcGameId>[] => FTC_GAME_IDS.map((id) => PLUGINS[id]);

/**
 * The match scouting form of an FTC game. Generated like any point-table game's, with two differences that keep it what the sister app's form was:
 * its score is the sum of the fields' own rules (no `game:<id>` custom scorer: the shared scorer resolves those through the default program's
 * registry only), and the sticky notes panel is on (its notes fold into the entry's comments).
 */
export function buildFtcGameForm(def: PointTableGameDefinition<FtcGameId>): Form {
  const form: Form = { ...buildGameForm(def), stickyNotes: { enabled: true, defaultOpen: false } };
  delete form.scoring;
  return form;
}

/** Each FTC game's match scouting form, by form id. */
export const FTC_GAME_FORMS: Readonly<Record<string, Form>> = Object.fromEntries(
  FTC_GAME_ID_LIST.map((id) => [FTC_GAME_DEFINITIONS[id].formId, buildFtcGameForm(FTC_GAME_DEFINITIONS[id])] as const)
);

/** Every form the FTC program has in code: its games' match forms, then the other six (lead scout, match strategy, drive reflection, pit scout, team strategy, helper), by id. */
export const FTC_BUILTIN_FORMS: Readonly<Record<string, Form>> = { ...FTC_GAME_FORMS, ...TEAM_BUILTIN_FORMS, ...PIT_BUILTIN_FORMS };

/** The form new FTC match entries use. */
export const DEFAULT_FTC_FORM_ID: string = FTC_GAME_DEFINITIONS[CURRENT_FTC_GAME_ID].formId;

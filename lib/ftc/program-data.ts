// The FTC program's data port for the shared pages (lib/program/data.ts): its reads and writes under programs/ftc/ (data/ftc/), and its games.

import { FTC_GAME_DEFINITIONS, FTC_GAME_ID_LIST, CURRENT_FTC_GAME_ID } from "@/config/games/ftc";
import { FTC_BUILTIN_FORMS } from "@/lib/ftc/games";
import type { ProgramData, ProgramSeason } from "@/lib/program/data";
import { getFormVersion, subscribeFormDocs, subscribeFormEntries, subscribeTeamAttendance, subscribeTeamDoc, subscribeTeamMembers, subscribeTeamScoutEntries, subscribeUserProfile } from "@/data/ftc/read";
import {
  adminUpdateFormEntry,
  deleteFormEntry,
  deleteScoutEntry,
  editOwnFormEntry,
  saveFormEntry,
  saveScoutEntry,
  setActiveEvents,
  setEventAttendance,
  updateFormEntry,
  updateMemberAccess,
  updateScoutEntry,
} from "@/data/ftc/write";

/** A game is a season, named like the stored data names it: the game id lower-cased. */
const seasonIdOf = (gameId: string): string => gameId.toLowerCase();

export const FTC_SEASONS: readonly ProgramSeason[] = FTC_GAME_ID_LIST.map((id) => {
  const def = FTC_GAME_DEFINITIONS[id];
  return { id: seasonIdOf(id), name: def.label, apiSeason: def.year, formId: def.formId, enabled: def.submittable };
});

export const ftcProgramData: ProgramData = {
  profile: { subscribe: subscribeUserProfile },
  team: { subscribe: subscribeTeamDoc, setActiveEvents },
  scoutEntries: { subscribeTeam: subscribeTeamScoutEntries, save: saveScoutEntry, update: updateScoutEntry, delete: deleteScoutEntry },
  formEntries: {
    subscribe: (teamId, query, onData, onError) => subscribeFormEntries(teamId, query, onData, onError),
    save: saveFormEntry,
    update: updateFormEntry,
    editOwn: editOwnFormEntry,
    adminUpdate: adminUpdateFormEntry,
    delete: deleteFormEntry,
  },
  members: { subscribe: subscribeTeamMembers, updateAccess: updateMemberAccess },
  attendance: { subscribeTeam: subscribeTeamAttendance, set: setEventAttendance },
  forms: { subscribeDocs: subscribeFormDocs, loadVersion: getFormVersion },
  games: { seasons: FTC_SEASONS, defaultSeasonId: seasonIdOf(CURRENT_FTC_GAME_ID), builtinForms: FTC_BUILTIN_FORMS },
};

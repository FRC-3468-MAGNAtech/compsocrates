// The FTC program's data port for the shared pages (lib/program/data.ts): its reads and writes under programs/ftc/ (data/ftc/), and its games.

import { FTC_GAME_DEFINITIONS, FTC_GAME_ID_LIST, CURRENT_FTC_GAME_ID } from "@/config/games/ftc";
import { FTC_BUILTIN_FORMS } from "@/lib/ftc/games";
import type { ProgramData, ProgramSeason } from "@/lib/program/data";
import { createManualEvent, deleteManualEvent, deleteManualMatches, importSchedule, setMatchesPublished, setMatchScores, subscribeLibraryEvents, subscribeLibraryMatches, upsertManualMatches } from "@/data/ftc/library";
import { getEvent, getMatchesForEvent } from "@/lib/events/actions";
import { claimSession, deleteSession, getSession, hasCompletedAttempt, subscribeOwnPausedSession, subscribeSession, subscribeTeamSessions, updateSession } from "@/data/ftc/practice";
import { fetchFtcSchedule } from "@/lib/ftc/library-import";
import { lookupTeamName } from "@/lib/ftc/team-lookup-client";
import { approveJoinRequest, denyJoinRequest, subscribePendingJoinRequests } from "@/data/ftc/join-requests";
import { getFormVersion, getScoutEntriesForEvent, getScoutEntriesForSession, subscribeAssignments, subscribeFormDocs, subscribeFormEntries, subscribePickList, subscribeTeamAssignments, subscribeTeamAttendance, subscribeTeamDoc, subscribeTeamMembers, subscribeTeamScoutEntries, subscribeUserProfile } from "@/data/ftc/read";
import {
  adminUpdateFormEntry,
  deleteFormEntry,
  publishAssignments,
  publishTeamAssignments,
  swapAssignmentSlot,
  createTeam,
  requestToJoinTeam,
  undoAssignments,
  undoTeamAssignments,
  deleteScoutEntry,
  editOwnFormEntry,
  editPickList,
  saveFormEntry,
  saveScoutEntry,
  importScoutEntries,
  setActiveEvents,
  setArchivedEvents,
  setFormSubmissionSettings,
  saveAccountTeams,
  setActiveForm,
  setEventAttendance,
  updateFormEntry,
  updateMemberAccess,
  updateScoutEntry,
  updateUserFields,
  updateUserProfile,
} from "@/data/ftc/write";

/** A game is a season, named like the stored data names it: the game id lower-cased. */
const seasonIdOf = (gameId: string): string => gameId.toLowerCase();

export const FTC_SEASONS: readonly ProgramSeason[] = FTC_GAME_ID_LIST.map((id) => {
  const def = FTC_GAME_DEFINITIONS[id];
  return { id: seasonIdOf(id), name: def.label, apiSeason: def.year, formId: def.formId, enabled: def.submittable };
});

export const ftcProgramData: ProgramData = {
  profile: { subscribe: subscribeUserProfile, update: updateUserProfile, updateFields: updateUserFields },
  team: { subscribe: subscribeTeamDoc, setActiveEvents, setArchivedEvents, setFormSubmissionSettings, saveAccountTeams, lookupTeamName, setActiveForm },
  scoutEntries: { subscribeTeam: subscribeTeamScoutEntries, save: saveScoutEntry, update: updateScoutEntry, delete: deleteScoutEntry, getForEvent: getScoutEntriesForEvent, importBatch: importScoutEntries },
  formEntries: {
    subscribe: (teamId, query, onData, onError) => subscribeFormEntries(teamId, query, onData, onError),
    save: saveFormEntry,
    update: updateFormEntry,
    editOwn: editOwnFormEntry,
    adminUpdate: adminUpdateFormEntry,
    delete: deleteFormEntry,
  },
  assignments: { subscribe: subscribeAssignments, publish: publishAssignments, undo: undoAssignments, swapSlot: swapAssignmentSlot },
  teamAssignments: { subscribeTeam: subscribeTeamAssignments, publish: publishTeamAssignments, undo: undoTeamAssignments },
  pickList: { subscribe: subscribePickList, edit: editPickList },
  members: { subscribe: subscribeTeamMembers, updateAccess: updateMemberAccess },
  enrollment: { createTeam, requestToJoin: (joinCode, input) => requestToJoinTeam(joinCode, input) },
  joinRequests: { subscribePending: subscribePendingJoinRequests, approve: approveJoinRequest, deny: denyJoinRequest },
  attendance: { subscribeTeam: subscribeTeamAttendance, set: setEventAttendance },
  forms: { subscribeDocs: subscribeFormDocs, loadVersion: getFormVersion },
  library: {
    subscribeEvents: subscribeLibraryEvents,
    subscribeMatches: subscribeLibraryMatches,
    createEvent: createManualEvent,
    deleteEvent: deleteManualEvent,
    upsertMatches: upsertManualMatches,
    setPublished: setMatchesPublished,
    setScores: setMatchScores,
    deleteMatches: deleteManualMatches,
    importSchedule: async (actor, { eventCode, seasonId }) => {
      const season = FTC_SEASONS.find((s) => s.id === seasonId);
      if (!season) return { ok: false, message: "Pick a season first." };
      // The fetch runs in the server actions (keys read through lib/server/env.ts there); only the schedule comes back.
      const schedule = await fetchFtcSchedule(
        { getEvent: (code, apiSeason) => getEvent(code, apiSeason, "ftc"), getMatches: (code, type, apiSeason) => getMatchesForEvent(code, type, apiSeason, "ftc") },
        { eventCode, apiSeason: season.apiSeason }
      );
      if (!schedule.ok) return { ok: false, message: schedule.message };
      try {
        return { ok: true, summary: await importSchedule(actor, { event: { eventCode: schedule.eventCode, eventName: schedule.eventName, seasonId }, matches: schedule.matches }) };
      } catch (err) {
        return { ok: false, message: err instanceof Error && err.message ? err.message : "Couldn't save the imported schedule. Run the import again: it picks up where it stopped." };
      }
    },
  },
  practice: {
    subscribeTeamSessions,
    subscribeOwnPaused: subscribeOwnPausedSession,
    subscribeSession,
    getSession,
    claimSession,
    updateSession,
    deleteSession,
    hasCompletedAttempt,
    entriesForSession: getScoutEntriesForSession,
  },
  games: { seasons: FTC_SEASONS, defaultSeasonId: seasonIdOf(CURRENT_FTC_GAME_ID), builtinForms: FTC_BUILTIN_FORMS },
};

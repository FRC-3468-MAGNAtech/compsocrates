"use client";

// The program-aware data layer of the shared pages. A program whose collections live under a namespace has a `ProgramData` port: realtime reads and
// writes that already return the app's own types (profile, team doc, scout entries, form entries, forms) plus its games. A hook that reads program data
// asks `useProgramData()`:
//   - a port: use it (the hook never learns which program it is);
//   - null: the root program, whose hooks keep their own reads exactly as they were (its collections, queries and adapter are not touched).
// This file is the only shared place that maps a program id to its port, so a new program adds one line here and nothing else.
//
// Every read reports a failure through `onError` (a `FirestoreFailure`): a failed read is never an empty list.

import type { Unsubscribe } from "firebase/firestore";
import type { ProgramId } from "@/config/programs/types";
import { ftcProgramData } from "@/lib/ftc/program-data";
import type { ActiveEventsState } from "@/lib/active-events";
import type { AssignmentsDoc, AssignmentVersion } from "@/lib/assignments";
import type { MatchType } from "@/lib/events/types";
import type { ScheduleSlot } from "@/lib/scheduler/types";
import type { TeamAssignKind, TeamAssignVersion, TeamAssignmentsDoc } from "@/lib/team-assignments/model";
import type { UserDoc } from "@/lib/auth";
import type { FirestoreFailure } from "@/lib/firestore-errors";
import type { EventAttendance } from "@/lib/event-attendance";
import type { FormEntry, NewFormEntry } from "@/lib/form-entries-model";
import type { AccountTeamsChange } from "@/lib/account-teams";
import type { PickOp } from "@/lib/pick-list/ops";
import type { PickListDoc } from "@/lib/pick-list/store";
import type { MemberAccess } from "@/lib/member-access";
import type { TeamMember } from "@/lib/team-members";
import type { FormDoc, FormVersion } from "@/lib/forms/resolve";
import type { FormSubmissionSettings } from "@/lib/forms/submission-settings";
import type { Form, FormValues, StickyNote } from "@/lib/forms/types";
import { useProgram } from "@/lib/program/context";
import type { SaveEntryInput, ScoutEntry } from "@/lib/scout-entries";
import type { TeamDoc } from "@/lib/team";
import type { LibraryEvent } from "@/lib/library/store";
import type { EventFormInput } from "@/lib/library/event-form";
import type { CreateEventResult, LibraryActor, LibraryImportOutcome, MatchScores, UpsertOptions, UpsertResult } from "@/lib/library/schedule";
import type { ValidMatch } from "@/lib/library/manual-match";
import type { LibraryVideo } from "@/lib/match-library";
import type { LibraryMatch } from "@/lib/match-library";
import type { AllianceColor, PracticeSession, SessionKind, SessionMode } from "@/lib/practice-sessions";
import type { LiveMatchScoutPresence } from "@/lib/live-presence";
import type { LobbyDoc, LobbyPlayer } from "@/lib/lobby";

export type DataError = (failure: FirestoreFailure) => void;

/** A request to join the viewer's team, waiting for a decision. `requestedAtMs` is null until the server time has arrived. */
export type PendingJoinRequest = { uid: string; name: string; requestedAtMs: number | null; /** The role the person asked for (a request field only; the server decides the real one). */ requestedRole?: string };

/** A season (a game the program scouts), as the form picker and the form resolver need it. */
export type ProgramSeason = {
  /** The id stored on library data and practice sessions. */
  id: string;
  name: string;
  apiSeason: number;
  /** The id of the season's built-in match scouting form. */
  formId: string;
  enabled: boolean;
};

export type FormEntriesQuery = { formId?: string; formType?: string; eventCode?: string };

export type ProgramData = {
  profile: {
    subscribe(uid: string, onData: (profile: UserDoc | null) => void, onError: DataError): Unsubscribe;
    /** A person changes their own name, theme or avatar. */
    update(uid: string, patch: Partial<Pick<UserDoc, "name" | "themeId" | "colorMode" | "gradientIntensity" | "avatar">>): Promise<void>;
    /**
     * Preference fields of the person's own user doc that the shared UI saves (glass level, workspace layout, changelog last-seen, push tokens).
     * Values may be Firestore sentinels. Callers go through `saveUserFields` (lib/program/user-fields.ts), which turns a failure into an error to show.
     */
    updateFields(uid: string, fields: Record<string, unknown>): Promise<void>;
  };
  team: {
    subscribe(teamId: string, onData: (team: TeamDoc | null) => void, onError: DataError): Unsubscribe;
    /** Sets the account's active events (admins and the owner, by the rules). */
    setActiveEvents(teamId: string, state: ActiveEventsState): Promise<void>;
    /** Writes the team's archived event codes (admins and the owner). Writes that one field and nothing else. */
    setArchivedEvents(teamId: string, codes: string[]): Promise<void>;
    /** Writes the team's form-submission switches (ADDITIVE `formSubmissionSettings`; admins and the owner). Writes that one field and nothing else. */
    setFormSubmissionSettings(teamId: string, settings: FormSubmissionSettings): Promise<void>;
    /** Memberships build 2: the team's "joiners may choose their role" switch (ADDITIVE `allowMemberRoleChoice`; admins and the owner). Writes that one field and nothing else. */
    setAllowMemberRoleChoice(teamId: string, value: boolean): Promise<void>;
    /** Team Settings: saves the account's teams and/or members' team assignments with one audit entry, in one batch (admins and the owner, by the rules). */
    saveAccountTeams(actor: { teamId: string; uid: string; name: string }, change: AccountTeamsChange): Promise<void>;
    /** Team Settings: asks the program's events API (on the server, keys never reach the browser) for a team's name by number. Rejects with a message to show; "found: false" for an unknown number. */
    lookupTeamName(teamId: string, number: number): Promise<{ found: boolean; name?: string }>;
    /** Team Settings: the form a season uses (`activeForms.{season}`), with its audit entry in the same batch (admins and the owner). */
    setActiveForm(actor: { teamId: string; uid: string; name: string }, seasonId: string, formId: string, previousFormId: string | null): Promise<void>;
  };
  scoutEntries: {
    /** Every entry of the team, all events and sources. */
    subscribeTeam(teamId: string, onData: (entries: ScoutEntry[]) => void, onError: DataError): Unsubscribe;
    save(teamId: string, uid: string, input: SaveEntryInput): Promise<void>;
    /** Applies an app-shaped patch to a stored entry (admins only, by the rules). */
    update(id: string, patch: Partial<ScoutEntry>): Promise<void>;
    delete(id: string): Promise<void>;
    /** One read of the event-sourced entries of one event of the team (equality-only: `teamId ==`, `eventCode ==`). What a recompute of that event starts from. */
    getForEvent(teamId: string, eventCode: string): Promise<ScoutEntry[]>;
    /** Writes imported entries under stable ids, in the one batch given (the caller leaves out ids that already exist, so a second import adds nothing). Resolves with the ids it wrote. */
    importBatch(teamId: string, uid: string, rows: { id: string; input: SaveEntryInput }[]): Promise<string[]>;
  };
  formEntries: {
    subscribe(teamId: string, query: FormEntriesQuery, onData: (entries: FormEntry[]) => void, onError: DataError): Unsubscribe;
    /** Saves an entry as yourself; resolves with its id. */
    save(teamId: string, uid: string, input: NewFormEntry): Promise<string>;
    update(id: string, patch: { values?: FormValues; stickyNotes?: StickyNote[] }): Promise<void>;
    /** A scout edits their own entry (and an audit entry is written in the same batch). */
    editOwn(
      actor: { teamId: string; uid: string; name: string },
      entry: Pick<FormEntry, "id" | "formId" | "eventCode" | "teamNumber" | "values" | "stickyNotes">,
      patch: { values: FormValues; stickyNotes: StickyNote[] }
    ): Promise<void>;
    /** Admins only, by the rules. */
    adminUpdate(id: string, patch: { excluded?: boolean; flags?: FormEntry["flags"]; values?: FormValues }): Promise<void>;
    delete(id: string): Promise<void>;
  };
  assignments: {
    /** One event's published match assignments (null while there are none). */
    subscribe(teamId: string, eventCode: string, onData: (doc: AssignmentsDoc | null) => void, onError: DataError): Unsubscribe;
    publish(teamId: string, eventCode: string, version: AssignmentVersion): Promise<void>;
    undo(teamId: string, eventCode: string): Promise<void>;
    swapSlot(teamId: string, eventCode: string, matchType: MatchType, matchNumber: number, slot: ScheduleSlot["slot"], newScoutUid: string | null): Promise<void>;
  };
  teamAssignments: {
    /** Pit scouting and team strategy assignments of the team, every event. */
    subscribeTeam(teamId: string, onData: (docs: TeamAssignmentsDoc[]) => void, onError: DataError): Unsubscribe;
    publish(teamId: string, eventCode: string, kind: TeamAssignKind, version: TeamAssignVersion, existing: TeamAssignmentsDoc | null): Promise<void>;
    undo(teamId: string, eventCode: string, kind: TeamAssignKind, existing: TeamAssignmentsDoc): Promise<void>;
  };
  pickList: {
    /** One event's shared pick list (null while it has never been written). */
    subscribe(teamId: string, eventCode: string, onData: (list: PickListDoc | null) => void, onError: DataError): Unsubscribe;
    /** Applies one edit transactionally with its audit entry; false when it changes nothing. */
    edit(ctx: { teamId: string; eventCode: string; uid: string; name: string }, op: PickOp): Promise<boolean>;
  };
  members: {
    /** The team's roster. */
    subscribe(teamId: string, onData: (members: TeamMember[]) => void, onError: DataError): Unsubscribe;
    /** Saves a role or admin change and its audit entry in one batch (admins and the owner, by the rules). */
    updateAccess(actor: { teamId: string; uid: string; name: string }, member: Pick<TeamMember, "uid" | "name"> & MemberAccess, changes: Partial<MemberAccess>): Promise<void>;
  };
  /** Approving or denying the requests to join the viewer's team (a member-manager of that team only, by the rules). */
  joinRequests: {
    /** The team's pending requests, oldest first. */
    subscribePending(teamId: string, onData: (requests: PendingJoinRequest[]) => void, onError: DataError): Unsubscribe;
    /** Creates the applicant's profile (a plain member) and marks the request approved, in one batch. */
    approve(teamId: string, request: Pick<PendingJoinRequest, "uid" | "name">, actorUid: string): Promise<void>;
    deny(teamId: string, requestUid: string, actorUid: string): Promise<void>;
  };
  attendance: {
    /** Every event the team has attendance recorded for. */
    subscribeTeam(teamId: string, onData: (records: EventAttendance[]) => void, onError: DataError): Unsubscribe;
    set(teamId: string, eventCode: string, uids: string[]): Promise<void>;
  };
  forms: {
    subscribeDocs(teamId: string, onData: (docs: Map<string, FormDoc>) => void, onError: DataError): Unsubscribe;
    loadVersion(teamId: string, formId: string, version: number): Promise<Form | null>;
    /** A stored form doc / version doc read tolerantly (the admin store writes through the program's own path and needs the same reader). */
    normalizeDoc?(docId: string, data: Record<string, unknown>): FormDoc;
    normalizeVersion?(docId: string, data: Record<string, unknown>): FormVersion | null;
  };
  /**
   * The scheduled-match library (events and matches; FTC: `programs/ftc/libraryEvents` and `libraryMatches`). The root program has none: its hooks read
   * the root collections themselves (`lib/match-library.ts`, `lib/library/store.ts`).
   */
  /** Admin Panel > Backups: the team's data as plain rows, by collection name (read only; team-scoped; nothing private). The root program's export reads its own collections. */
  backup?: {
    read(teamId: string): Promise<Record<string, Record<string, unknown>[]>>;
  };
  library: {
    /** The shared (imported) events plus the team's own hand-made ones, optionally of one season. */
    subscribeEvents(teamId: string, seasonId: string | null, onData: (events: LibraryEvent[]) => void, onError: DataError): Unsubscribe;
    /** The SHARED official matches of one season, read once (published, `origin == "api"`): what an account with no team practises on. Never a team's hand-made matches. */
    fetchSharedMatches(seasonId: string): Promise<{ matches: LibraryMatch[]; unreadable: number }>;
    /** One event's, one season's or all matches; `includeUnpublished` is for admins (a scout's query must ask for published only). */
    subscribeMatches(teamId: string, filter: { eventCode?: string | null; seasonId?: string | null; includeUnpublished: boolean }, onData: (matches: LibraryMatch[], unreadable: number) => void, onError: DataError): Unsubscribe;
    /** Creates a hand-made event owned by the actor's team (no API key needed). */
    createEvent(actor: LibraryActor, input: EventFormInput, seasonId: string, existing: readonly LibraryEvent[]): Promise<CreateEventResult>;
    /** Edits a hand-made event's details; a new name is copied onto its matches. */
    updateEvent(actor: LibraryActor, event: LibraryEvent, patch: Pick<EventFormInput, "name" | "date" | "sourceUrl" | "defaultVideoUrl">, matchIds: string[]): Promise<void>;
    /** Deletes a hand-made event; refuses while it still has matches (delete them first), as the default program does. */
    deleteEvent(actor: LibraryActor, event: LibraryEvent): Promise<void>;
    /** Creates or replaces hand-made matches of one event. A new match is an unpublished draft; an edit keeps its published state. */
    upsertMatches(actor: LibraryActor, event: LibraryEvent, matches: ValidMatch[], options: UpsertOptions & { keepScores?: boolean }): Promise<UpsertResult>;
    /** One YouTube link on many matches (each keeps its own start and end), and one match's video (null removes it). */
    setVideoLink(actor: LibraryActor, matches: Pick<LibraryMatch, "id" | "video">[], videoId: string): Promise<void>;
    setMatchVideo(actor: LibraryActor, id: string, video: LibraryVideo | null): Promise<void>;
    setPublished(actor: LibraryActor, ids: string[], published: boolean): Promise<number>;
    /** Sets (or, with null, clears) the OFFICIAL score of one match: what Practice Scouting compares a session's total with. A match with none is "No official score yet". */
    setScores(actor: LibraryActor, id: string, scores: MatchScores | null): Promise<number>;
    deleteMatches(actor: LibraryActor, ids: string[]): Promise<number>;
    /**
     * Fetches the event's schedule on the server (keys never reach the browser) and writes it under stable ids, so importing twice updates in place.
     * A missing or rejected key, a rate limit or an unknown event comes back as `{ ok: false, message }` with nothing written.
     */
    importEvent(actor: LibraryActor, args: { eventCode: string; seasonId: string }): Promise<LibraryImportOutcome>;
    /** Optional: how many completed practice sessions used a match (the edit warning); a program with none leaves it out and the warning is not shown. */
    countCompletedSessions?(teamId: string, matchId: string): Promise<number>;
  };
  /**
   * Practice sessions (FTC: `programs/ftc/practiceSessions`). The root program has none: its hooks read the root collections themselves
   * (`lib/practice-sessions.ts`, `lib/practice-extras.ts`). Every list is `teamId ==` (team-wide, never by event); a failed read calls `onError`.
   */
  practice: {
    subscribeTeamSessions(teamId: string, onData: (sessions: PracticeSession[]) => void, onError: DataError): Unsubscribe;
    subscribeOwnPaused(teamId: string, uid: string, onData: (session: PracticeSession | null) => void, onError: DataError): Unsubscribe;
    subscribeSession(sessionId: string, onData: (session: PracticeSession | null) => void, onError: DataError): Unsubscribe;
    getSession(sessionId: string): Promise<PracticeSession | null>;
    /** Reserves a unique session id (a stub doc) and returns it. */
    claimSession(teamId: string, uid: string, kind: SessionKind): Promise<string>;
    updateSession(sessionId: string, patch: Partial<PracticeSession>): Promise<void>;
    deleteSession(sessionId: string): Promise<void>;
    hasCompletedAttempt(teamId: string, uid: string, libraryMatchId: string, alliance: AllianceColor): Promise<boolean>;
    /** Every entry saved so far for one session (both robots), found by the session id. */
    entriesForSession(teamId: string, sessionId: string): Promise<ScoutEntry[]>;
    /** The team's live sessions only (`teamId ==`, `kind ==`). */
    subscribeTeamLiveSessions(teamId: string, onData: (sessions: PracticeSession[]) => void, onError: DataError, ownUid?: string): Unsubscribe;
  };
  /**
   * Live practice presence (FTC: `programs/ftc/liveMatches/{key}/scouts/{uid}`). The root program has none: `lib/live-presence.ts` reads its own collections
   * (and its collection-group query). A port NEVER uses a collection-group query: `subscribeTeamScouts` derives the match keys from the team's open live
   * sessions and reads each match's `scouts` by path.
   */
  live: {
    upsertPresence(matchKey: string, presence: Omit<LiveMatchScoutPresence, "lastSeen">): Promise<void>;
    removePresence(matchKey: string, uid: string): Promise<void>;
    subscribeMatchScouts(matchKey: string, teamId: string, onData: (scouts: LiveMatchScoutPresence[]) => void, onError: DataError): Unsubscribe;
    subscribeTeamScouts(teamId: string, onData: (scouts: (LiveMatchScoutPresence & { matchKey: string })[]) => void, onError: DataError): Unsubscribe;
  };
  /**
   * Practice lobbies (FTC: `programs/ftc/lobbies`). The root program has none: `lib/lobby.ts` reads its own collections. `subscribeMyLobby` replaces the
   * root's collection-group query on `players`: it lists the team's lobbies and reads the caller's own player doc in each open one, by path.
   */
  lobby: {
    claimLobby(teamId: string, hostUid: string, hostName: string, seasonId: string, mode: Exclude<SessionMode, null>): Promise<string>;
    updateLobby(lobbyId: string, patch: Partial<LobbyDoc>): Promise<void>;
    heartbeatHost(lobbyId: string): Promise<void>;
    subscribeLobby(lobbyId: string, onData: (lobby: LobbyDoc | null) => void, onError: DataError): Unsubscribe;
    joinLobby(lobbyId: string, teamId: string, uid: string, name: string): Promise<void>;
    heartbeatPlayer(lobbyId: string, uid: string): Promise<void>;
    markPlayerSubmitted(lobbyId: string, uid: string): Promise<void>;
    resetPlayerSubmitted(lobbyId: string, uid: string): Promise<void>;
    leaveLobbyPlayer(lobbyId: string, uid: string): Promise<void>;
    subscribePlayers(lobbyId: string, teamId: string, onData: (players: LobbyPlayer[]) => void, onError: DataError): Unsubscribe;
    subscribeLobbySessions(teamId: string, lobbyId: string, onData: (sessions: PracticeSession[]) => void, onError: DataError): Unsubscribe;
    subscribeMyLobby(teamId: string, uid: string, onData: (lobbyId: string | null) => void, onError: DataError): Unsubscribe;
  };
  games: {
    seasons: readonly ProgramSeason[];
    defaultSeasonId: string;
    /** The program's built-in forms by id: its games' match forms and its other forms in code (pit scout, lead scout, strategy ...). */
    builtinForms: Readonly<Record<string, Form>>;
  };
};

/**
 * The program's data port, or null for the root program (whose hooks read their own collections). The table is built per call, not at load: the modules a
 * port imports can import this one back (the entry writers share types and helpers with the hooks), and a table built at load would capture a port that
 * has not finished loading.
 */
export function programData(program: ProgramId): ProgramData | null {
  const ports: Partial<Record<ProgramId, ProgramData>> = { ftc: ftcProgramData };
  return ports[program] ?? null;
}

/** The active program's data port, or null for the root program. */
export function useProgramData(): ProgramData | null {
  return programData(useProgram());
}

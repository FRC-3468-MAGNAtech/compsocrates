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
import type { UserDoc } from "@/lib/auth";
import type { FirestoreFailure } from "@/lib/firestore-errors";
import type { EventAttendance } from "@/lib/event-attendance";
import type { FormEntry, NewFormEntry } from "@/lib/form-entries-model";
import type { MemberAccess } from "@/lib/member-access";
import type { TeamMember } from "@/lib/team-members";
import type { FormDoc } from "@/lib/forms/resolve";
import type { Form, FormValues, StickyNote } from "@/lib/forms/types";
import { useProgram } from "@/lib/program/context";
import type { SaveEntryInput, ScoutEntry } from "@/lib/scout-entries";
import type { TeamDoc } from "@/lib/team";

export type DataError = (failure: FirestoreFailure) => void;

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
  profile: { subscribe(uid: string, onData: (profile: UserDoc | null) => void, onError: DataError): Unsubscribe };
  team: {
    subscribe(teamId: string, onData: (team: TeamDoc | null) => void, onError: DataError): Unsubscribe;
    /** Sets the account's active events (admins and the owner, by the rules). */
    setActiveEvents(teamId: string, state: ActiveEventsState): Promise<void>;
  };
  scoutEntries: {
    /** Every entry of the team, all events and sources. */
    subscribeTeam(teamId: string, onData: (entries: ScoutEntry[]) => void, onError: DataError): Unsubscribe;
    save(teamId: string, uid: string, input: SaveEntryInput): Promise<void>;
    /** Applies an app-shaped patch to a stored entry (admins only, by the rules). */
    update(id: string, patch: Partial<ScoutEntry>): Promise<void>;
    delete(id: string): Promise<void>;
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
  members: {
    /** The team's roster. */
    subscribe(teamId: string, onData: (members: TeamMember[]) => void, onError: DataError): Unsubscribe;
    /** Saves a role or admin change and its audit entry in one batch (admins and the owner, by the rules). */
    updateAccess(actor: { teamId: string; uid: string; name: string }, member: Pick<TeamMember, "uid" | "name"> & MemberAccess, changes: Partial<MemberAccess>): Promise<void>;
  };
  attendance: {
    /** Every event the team has attendance recorded for. */
    subscribeTeam(teamId: string, onData: (records: EventAttendance[]) => void, onError: DataError): Unsubscribe;
    set(teamId: string, eventCode: string, uids: string[]): Promise<void>;
  };
  forms: {
    subscribeDocs(teamId: string, onData: (docs: Map<string, FormDoc>) => void, onError: DataError): Unsubscribe;
    loadVersion(teamId: string, formId: string, version: number): Promise<Form | null>;
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

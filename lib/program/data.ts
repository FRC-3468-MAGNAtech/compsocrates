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
import type { UserDoc } from "@/lib/auth";
import type { FirestoreFailure } from "@/lib/firestore-errors";
import type { FormEntry } from "@/lib/form-entries-model";
import type { FormDoc } from "@/lib/forms/resolve";
import type { Form } from "@/lib/forms/types";
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
  team: { subscribe(teamId: string, onData: (team: TeamDoc | null) => void, onError: DataError): Unsubscribe };
  scoutEntries: {
    /** Every entry of the team, all events and sources. */
    subscribeTeam(teamId: string, onData: (entries: ScoutEntry[]) => void, onError: DataError): Unsubscribe;
    save(teamId: string, uid: string, input: SaveEntryInput): Promise<void>;
  };
  formEntries: { subscribe(teamId: string, query: FormEntriesQuery, onData: (entries: FormEntry[]) => void, onError: DataError): Unsubscribe };
  forms: {
    subscribeDocs(teamId: string, onData: (docs: Map<string, FormDoc>) => void, onError: DataError): Unsubscribe;
    loadVersion(teamId: string, formId: string, version: number): Promise<Form | null>;
  };
  games: {
    seasons: readonly ProgramSeason[];
    defaultSeasonId: string;
    /** The program's built-in forms by id (its games' match forms). */
    builtinForms: Readonly<Record<string, Form>>;
  };
};

const PORTS: Partial<Record<ProgramId, ProgramData>> = { ftc: ftcProgramData };

/** The program's data port, or null for the root program (whose hooks read their own collections). */
export function programData(program: ProgramId): ProgramData | null {
  return PORTS[program] ?? null;
}

/** The active program's data port, or null for the root program. */
export function useProgramData(): ProgramData | null {
  return programData(useProgram());
}

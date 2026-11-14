/**
 * Reads and live subscriptions for the FTC collections under `programs/ftc/`: scoutEntries, formEntries, forms (and their versions),
 * teams and users. Every document goes through the converters beside this file, so callers get the app's own types.
 *
 * Rules this file keeps:
 *  - Every path is built by `lib/firebase/paths.ts` with an explicit program. Nothing here can name a root collection.
 *  - Every list read is a `where teamId == <team>` query (what the rules need to allow it) plus equality filters. There are no
 *    collection-group reads: under the root rules they would evaluate against the other program's profile.
 *  - Team pages read the team's data whole and filter by event only where the page is event-scoped (`...ForEvent`, `subscribeScoutEntries`);
 *    `getScoutEntries` / `subscribeTeamScoutEntries` are team-wide and cross-event on purpose (scout accuracy, scout stats).
 *  - A failed read says so. `get*` reports the failure (`reportFirestoreError`) and rethrows it, so the caller can show it with
 *    `describeFirestoreError`. `subscribe*` takes a required `onError` and calls it with the `FirestoreFailure`; it never delivers an
 *    empty list in place of an error.
 * Pure conversion lives in the sibling files (no Firebase there); this is the only file in the folder that imports Firestore.
 */
import {
  collection,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  type DocumentReference,
  type Query,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { programCollection, programDoc, programPath } from "@/lib/firebase/paths";
import { reportFirestoreError, type FirestoreFailure } from "@/lib/firestore-errors";
import type { UserDoc } from "@/lib/auth";
import type { MatchType } from "@/lib/events/types";
import type { AssignmentsDoc } from "@/lib/assignments";
import type { EventAttendance } from "@/lib/event-attendance";
import type { FormEntry } from "@/lib/form-entries-model";
import type { PickListDoc } from "@/lib/pick-list/store";
import { formDocId, type FormDoc, type FormVersion } from "@/lib/forms/resolve";
import type { Form } from "@/lib/forms/types";
import type { ScoutEntry } from "@/lib/scout-entries";
import type { TeamAssignmentsDoc } from "@/lib/team-assignments/model";
import type { TeamDoc } from "@/lib/team";
import type { TeamMember } from "@/lib/team-members";
import { ftcDocsToFormEntries } from "@/data/ftc/form-entries";
import { ftcDocsToFormDocs, ftcDocToFormDoc, ftcDocToFormVersion } from "@/data/ftc/forms";
import { ftcDocsToScoutEntries, isEventEntry, type FtcRawRow } from "@/data/ftc/scouting";
import { ftcTeamToTeamDoc } from "@/data/ftc/teams";
import { ftcUserToMember, ftcUserToProfile } from "@/data/ftc/users";
import { ftcDocsToAttendance } from "@/data/ftc/attendance";
import { ftcDocToPickList, ftcPickListId } from "@/data/ftc/pick-list";
import { ftcDocsToTeamAssignments, pickMatchAssignments } from "@/data/ftc/assignments";
import { isRecord } from "@/data/ftc/util";

const PROGRAM = "ftc" as const;

const SCOUT_ENTRIES = "scoutEntries";
const FORM_ENTRIES = "formEntries";
const FORMS = "forms";
const TEAMS = "teams";
const USERS = "users";
const EVENT_ATTENDANCE = "eventAttendance";
const PICK_LISTS = "pickLists";
const ASSIGNMENTS = "assignments";

type Equality = [field: string, value: string | number];
type Target = { q: Query; path: string };
type Failure = (failure: FirestoreFailure) => void;

/** `programs/ftc/<name> where teamId == <team>` plus any extra equality filters, with a label for error reports. */
function teamQuery(name: string, teamId: string, extra: Equality[] = []): Target {
  const filters: Equality[] = [["teamId", teamId], ...extra];
  return {
    q: query(programCollection(db, PROGRAM, name), ...filters.map(([field, value]) => where(field, "==", value))),
    path: `${programPath(PROGRAM, name)} where ${filters.map(([field, value]) => `${field} == ${JSON.stringify(value)}`).join(", ")}`,
  };
}

const rawRow = (d: QueryDocumentSnapshot): FtcRawRow => ({ id: d.id, data: d.data() });

async function readRows<T>(context: string, target: Target, convert: (rows: FtcRawRow[]) => T): Promise<T> {
  try {
    const snap = await getDocs(target.q);
    return convert(snap.docs.map(rawRow));
  } catch (err) {
    reportFirestoreError(context, err, target.path);
    throw err;
  }
}

function watchRows(context: string, target: Target, onRows: (rows: FtcRawRow[], pendingWrites: number) => void, onError: Failure, withMetadata = false): Unsubscribe {
  const next = (snap: QuerySnapshot) => onRows(snap.docs.map(rawRow), snap.docs.filter((d) => d.metadata.hasPendingWrites).length);
  const fail = (err: unknown) => onError(reportFirestoreError(context, err, target.path));
  return withMetadata ? onSnapshot(target.q, { includeMetadataChanges: true }, next, fail) : onSnapshot(target.q, next, fail);
}

async function readOne<T>(context: string, ref: DocumentReference, convert: (id: string, data: Record<string, unknown>) => T): Promise<T | null> {
  try {
    const snap = await getDoc(ref);
    const data = snap.data();
    return snap.exists() && isRecord(data) ? convert(snap.id, data) : null;
  } catch (err) {
    reportFirestoreError(context, err, ref.path);
    throw err;
  }
}

function watchOne<T>(context: string, ref: DocumentReference, convert: (id: string, data: Record<string, unknown>) => T, onData: (value: T | null) => void, onError: Failure): Unsubscribe {
  return onSnapshot(
    ref,
    (snap) => {
      const data = snap.data();
      onData(snap.exists() && isRecord(data) ? convert(snap.id, data) : null);
    },
    (err) => onError(reportFirestoreError(context, err, ref.path))
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// scoutEntries (Match Scout entries)
// ---------------------------------------------------------------------------------------------------------------------

/** Every entry of the team (all sources, all events). Team-wide on purpose: scout accuracy and stats are never filtered by event. */
export function getScoutEntries(teamId: string): Promise<ScoutEntry[]> {
  return readRows("Couldn't load scout entries", teamQuery(SCOUT_ENTRIES, teamId), ftcDocsToScoutEntries);
}

/** "event"-sourced entries for one event only: practice-session rows can carry the same event code and must not mix into event analytics. */
export function getScoutEntriesForEvent(teamId: string, eventCode: string): Promise<ScoutEntry[]> {
  return readRows("Couldn't load scout entries", teamQuery(SCOUT_ENTRIES, teamId, [["eventCode", eventCode]]), (rows) => ftcDocsToScoutEntries(rows).filter(isEventEntry));
}

/** Every entry saved so far for one practice session. */
export function getScoutEntriesForSession(teamId: string, sessionId: string): Promise<ScoutEntry[]> {
  return readRows("Couldn't load scout entries", teamQuery(SCOUT_ENTRIES, teamId, [["sessionId", sessionId]]), ftcDocsToScoutEntries);
}

/**
 * Realtime "event"-sourced entries for one event. `pendingWrites` counts the returned docs that are local writes the server has not
 * acknowledged yet (drives the "N pending sync" indicator).
 */
export function subscribeScoutEntries(teamId: string, eventCode: string, onData: (entries: ScoutEntry[], pendingWrites: number) => void, onError: Failure): Unsubscribe {
  return watchRows(
    "Couldn't load scout entries",
    teamQuery(SCOUT_ENTRIES, teamId, [["eventCode", eventCode]]),
    (rows, pending) => onData(ftcDocsToScoutEntries(rows).filter(isEventEntry), pending),
    onError,
    true
  );
}

/** Realtime, every entry of the team (all sources, all events). */
export function subscribeTeamScoutEntries(teamId: string, onData: (entries: ScoutEntry[]) => void, onError: Failure): Unsubscribe {
  return watchRows("Couldn't load scout entries", teamQuery(SCOUT_ENTRIES, teamId), (rows) => onData(ftcDocsToScoutEntries(rows)), onError);
}

/** Realtime, the entries for one match (both alliance robots), whatever session or source they came from. */
export function subscribeScoutEntriesForMatch(
  teamId: string,
  eventCode: string,
  matchType: MatchType,
  matchNumber: number,
  onData: (entries: ScoutEntry[]) => void,
  onError: Failure
): Unsubscribe {
  const target = teamQuery(SCOUT_ENTRIES, teamId, [
    ["eventCode", eventCode],
    ["matchType", matchType],
    ["matchNumber", matchNumber],
  ]);
  return watchRows("Couldn't load scout entries", target, (rows) => onData(ftcDocsToScoutEntries(rows)), onError);
}

// ---------------------------------------------------------------------------------------------------------------------
// formEntries (the team's other forms)
// ---------------------------------------------------------------------------------------------------------------------

export type FormEntriesFilter = { formId?: string; formType?: string; eventCode?: string };

function formEntriesTarget(teamId: string, filter: FormEntriesFilter): Target {
  const extra: Equality[] = [];
  if (filter.formId) extra.push(["formId", filter.formId]);
  if (filter.formType) extra.push(["formType", filter.formType]);
  if (filter.eventCode) extra.push(["eventCode", filter.eventCode]);
  return teamQuery(FORM_ENTRIES, teamId, extra);
}

/** The team's form entries, newest first, optionally of one form and/or one event. */
export function getFormEntries(teamId: string, filter: FormEntriesFilter = {}): Promise<FormEntry[]> {
  return readRows("Couldn't load form entries", formEntriesTarget(teamId, filter), ftcDocsToFormEntries);
}

/** Realtime form entries, newest first, optionally of one form and/or one event. */
export function subscribeFormEntries(teamId: string, filter: FormEntriesFilter, onData: (entries: FormEntry[]) => void, onError: Failure): Unsubscribe {
  return watchRows("Couldn't load form entries", formEntriesTarget(teamId, filter), (rows) => onData(ftcDocsToFormEntries(rows)), onError);
}

// ---------------------------------------------------------------------------------------------------------------------
// forms and their published versions
// ---------------------------------------------------------------------------------------------------------------------

/** Every form doc of the account (drafts, latest published version numbers, archived/active flags), keyed by form id. */
export function getFormDocs(teamId: string): Promise<Map<string, FormDoc>> {
  return readRows("Couldn't load forms", teamQuery(FORMS, teamId), ftcDocsToFormDocs);
}

/** Realtime form docs, keyed by form id. Versions are read on demand with `getFormVersion`. */
export function subscribeFormDocs(teamId: string, onData: (docs: Map<string, FormDoc>) => void, onError: Failure): Unsubscribe {
  return watchRows("Couldn't load forms", teamQuery(FORMS, teamId), (rows) => onData(ftcDocsToFormDocs(rows)), onError);
}

/** One form doc, or null when the account has no doc for it (an untouched built-in has none). */
export function getFormDoc(teamId: string, formId: string): Promise<FormDoc | null> {
  return readOne("Couldn't load the form", programDoc(db, PROGRAM, FORMS, formDocId(teamId, formId)), ftcDocToFormDoc);
}

/** One published version's form, or null when it does not exist (or has no form in it). */
export async function getFormVersion(teamId: string, formId: string, version: number): Promise<Form | null> {
  const found = await readOne("Couldn't load the form version", programDoc(db, PROGRAM, FORMS, formDocId(teamId, formId), "versions", String(version)), ftcDocToFormVersion);
  return found?.form ?? null;
}

/** Every published version of a form, newest first (the builder's version history). */
export async function getFormVersions(teamId: string, formId: string): Promise<FormVersion[]> {
  const docId = formDocId(teamId, formId);
  const path = `${programPath(PROGRAM, FORMS)}/${docId}/versions`;
  try {
    const snap = await getDocs(collection(db, programPath(PROGRAM, FORMS), docId, "versions"));
    return snap.docs
      .map((d) => ftcDocToFormVersion(docId, d.data()))
      .filter((version): version is FormVersion => version !== null)
      .sort((a, b) => b.version - a.version);
  } catch (err) {
    reportFirestoreError("Couldn't load the form versions", err, path);
    throw err;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// teams
// ---------------------------------------------------------------------------------------------------------------------

/** The account's team doc, or null when it does not exist. */
export function getTeamDoc(teamId: string): Promise<TeamDoc | null> {
  return readOne("Couldn't load the team", programDoc(db, PROGRAM, TEAMS, teamId), ftcTeamToTeamDoc);
}

/** Realtime team doc (null while it does not exist). Teams can only be read by id: the rules do not allow listing them. */
export function subscribeTeamDoc(teamId: string, onData: (team: TeamDoc | null) => void, onError: Failure): Unsubscribe {
  return watchOne("Couldn't load the team", programDoc(db, PROGRAM, TEAMS, teamId), ftcTeamToTeamDoc, onData, onError);
}

// ---------------------------------------------------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------------------------------------------------

/** The team's roster. */
export function getTeamMembers(teamId: string): Promise<TeamMember[]> {
  return readRows("Couldn't load the team members", teamQuery(USERS, teamId), (rows) => rows.flatMap((row) => (isRecord(row.data) ? [ftcUserToMember(row.id, row.data)] : [])));
}

/** Realtime roster. */
export function subscribeTeamMembers(teamId: string, onData: (members: TeamMember[]) => void, onError: Failure): Unsubscribe {
  return watchRows(
    "Couldn't load the team members",
    teamQuery(USERS, teamId),
    (rows) => onData(rows.flatMap((row) => (isRecord(row.data) ? [ftcUserToMember(row.id, row.data)] : []))),
    onError
  );
}

/** One account's profile, or null when it has no user doc here. */
export function getUserProfile(uid: string): Promise<UserDoc | null> {
  return readOne("Couldn't load the profile", programDoc(db, PROGRAM, USERS, uid), ftcUserToProfile);
}

/** Realtime profile (null while the account has no user doc here). */
export function subscribeUserProfile(uid: string, onData: (profile: UserDoc | null) => void, onError: Failure): Unsubscribe {
  return watchOne("Couldn't load the profile", programDoc(db, PROGRAM, USERS, uid), ftcUserToProfile, onData, onError);
}

// ---------------------------------------------------------------------------------------------------------------------
// event attendance
// ---------------------------------------------------------------------------------------------------------------------

/** Realtime, every event the team has attendance recorded for. */
export function subscribeTeamAttendance(teamId: string, onData: (records: EventAttendance[]) => void, onError: Failure): Unsubscribe {
  return watchRows("Couldn't load event attendance", teamQuery(EVENT_ATTENDANCE, teamId), (rows) => onData(ftcDocsToAttendance(rows)), onError);
}

// ---------------------------------------------------------------------------------------------------------------------
// the shared pick list
// ---------------------------------------------------------------------------------------------------------------------

/** Realtime pick list of one event (null while it has never been written). Read by id: the rules allow a teammate to read the account's lists, not to list them. */
export function subscribePickList(teamId: string, eventCode: string, onData: (list: PickListDoc | null) => void, onError: Failure): Unsubscribe {
  return watchOne("Couldn't load the pick list", programDoc(db, PROGRAM, PICK_LISTS, ftcPickListId(teamId, eventCode)), (_id, data) => ftcDocToPickList(data), onData, onError);
}

// ---------------------------------------------------------------------------------------------------------------------
// assignments (match scouting, and pit scouting / team strategy)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Realtime match assignments of one event (null while none are published). Read as a team-and-event query, not by id: the rules read the doc's own `teamId`, so a
 * direct read of an event with no assignments yet would be refused.
 */
export function subscribeAssignments(teamId: string, eventCode: string, onData: (doc: AssignmentsDoc | null) => void, onError: Failure): Unsubscribe {
  return watchRows("Couldn't load the assignments", teamQuery(ASSIGNMENTS, teamId, [["eventCode", eventCode]]), (rows) => onData(pickMatchAssignments(teamId, eventCode, rows)), onError);
}

/** Realtime pit scouting and team strategy assignments of the team, every event. */
export function subscribeTeamAssignments(teamId: string, onData: (docs: TeamAssignmentsDoc[]) => void, onError: Failure): Unsubscribe {
  return watchRows("Couldn't load the team assignments", teamQuery(ASSIGNMENTS, teamId), (rows) => onData(ftcDocsToTeamAssignments(rows)), onError);
}

/** One read of an event's match assignments (the writers need the stored version before changing it). */
export function getAssignments(teamId: string, eventCode: string): Promise<AssignmentsDoc | null> {
  return readRows("Couldn't load the assignments", teamQuery(ASSIGNMENTS, teamId, [["eventCode", eventCode]]), (rows) => pickMatchAssignments(teamId, eventCode, rows));
}

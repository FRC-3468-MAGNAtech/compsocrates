"use client";

import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { downloadTextFile } from "@/lib/download";
import { logAuditEvent } from "@/lib/audit-log";
import { entriesToCsv } from "@/lib/analytics/csv";
import { currentEventName } from "@/lib/events/event-names";
import { collectEventKeys, collectStoredEventNames, type StoredNameRow } from "@/lib/events/stored-names";
import { buildGameSchema, unionForms } from "@/lib/analytics/game-schema";
import { builtinFormResolver, type FormResolver } from "@/lib/forms/resolver";
import { DEFAULT_FORM_ID, getBuiltinForm } from "@/lib/forms/builtin";
import type { Form } from "@/lib/forms/types";
import { getEntries } from "@/lib/scout-entries";
import { BRAND } from "@/config/brand";
import { DEFAULT_PROGRAM, type ProgramId } from "@/config/programs/types";
import { programData } from "@/lib/program/data";

/**
 * The collections the team's data lives in, each scoped to this team. D1: these are CS's collections (`scouting`, the four
 * assignment collections), not the app's `scoutEntries` / `assignments` / `eventAttendance`: event attendance and the pick list are
 * fields of the `teams` doc, which is exported with it below. `teams` (just this team's own doc) and `libraryMatches` (shared,
 * not teamId-scoped) are handled separately. Collections added later (liveMatches, notifications, lobbies) are deliberately
 * left out.
 */
const TEAM_SCOPED_COLLECTIONS = ["users", "scouting", "practiceSessions", "matchAssignments", "pitAssignments", "teamAssignments", "practiceAssignments", "auditLog"] as const;

export type BackupSummary = { collection: string; count: number }[];

/** The default program's collections for one team: CS's own, each scoped to the team (the shared library is not team-scoped), in the order the file has always listed them. */
async function readDefaultCollections(teamId: string): Promise<{ collections: Record<string, unknown[]> }> {
  const collections: Record<string, unknown[]> = {};
  for (const name of TEAM_SCOPED_COLLECTIONS) {
    const snap = await getDocs(query(collection(db, name), where("teamId", "==", teamId)));
    collections[name] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  const libSnap = await getDocs(collection(db, "libraryMatches"));
  collections.libraryMatches = libSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  // P15: hand-typed (manual) matches exist nowhere else, so the library's events — and any unpublished matches, which an admin reads in full above — are part of the backup.
  const eventSnap = await getDocs(collection(db, "libraryEvents"));
  collections.libraryEvents = eventSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const teamSnap = await getDoc(doc(db, "teams", teamId));
  collections.teams = teamSnap.exists() ? [{ id: teamSnap.id, ...teamSnap.data() }] : [];
  return { collections };
}

/** Reads every in-scope collection for `teamId` and triggers a single JSON download — a competition-day safety net, not a restore tool (there's no import side). */
export async function exportAllDataJson(teamId: string, actorUid: string, actorName: string, program: ProgramId = DEFAULT_PROGRAM): Promise<BackupSummary> {
  const collections: Record<string, unknown[]> = {};
  const summary: BackupSummary = [];

  // A program with its own data port reads its own collections (team-scoped, nothing private); the default program's reads are exactly what they were.
  const port = programData(program)?.backup;
  const read = port ? { collections: await port.read(teamId) } : await readDefaultCollections(teamId);
  Object.assign(collections, read.collections);
  for (const [name, rows] of Object.entries(collections)) summary.push({ collection: name, count: rows.length });

  // Every event key in the backup, with its name (API, then names stored in these documents and the team doc, then the static table), so the file reads without the app.
  const rowsOf = (name: string) => (collections[name] ?? []) as StoredNameRow[];
  const teamRow = collections.teams?.[0] as { selectedEventNames?: Record<string, string> } | undefined;
  const sources = Object.values(collections) as StoredNameRow[][];
  const stored = collectStoredEventNames(teamRow?.selectedEventNames, ...sources);
  const eventNames: Record<string, string> = {};
  for (const key of collectEventKeys(rowsOf("scouting"), rowsOf("scoutEntries"), rowsOf("formEntries"), rowsOf("practiceSessions"), rowsOf("matchAssignments"), rowsOf("pitAssignments"), rowsOf("teamAssignments"), rowsOf("practiceAssignments"), rowsOf("assignments"), rowsOf("libraryMatches"), rowsOf("libraryEvents"))) {
    eventNames[key] = currentEventName(key, stored);
  }

  // The default program's file is unchanged; another program's names itself, so a file can never be mistaken for the other program's.
  const payload = { exportedAt: new Date().toISOString(), ...(port ? { program } : {}), teamId, eventNames, collections };
  downloadTextFile(`${BRAND.filePrefix}-backup-${teamId}-${Date.now()}.json`, JSON.stringify(payload, null, 2), "application/json");
  await logAuditEvent(teamId, actorUid, actorName, "export-backup", { format: "json", summary }, null, null, program);
  return summary;
}

/**
 * Every scouted entry of the team (any source: official, live and practice rows of CS's `scouting`, read through the adapter), as one CSV, names never anonymized (this is an admin-only export). P21: the columns are the union of
 * the forms the entries were scouted with (`resolveForm` finds each entry's form; the default knows only the built-ins), so custom-form entries export too.
 */
export async function exportEntriesCsv(teamId: string, actorUid: string, actorName: string, resolveForm: FormResolver = builtinFormResolver, program: ProgramId = DEFAULT_PROGRAM, fallbackForm?: Form): Promise<number> {
  const entries = await getEntries(teamId, program);
  const used = new Map<string, Form>();
  for (const e of entries) {
    const f = resolveForm(e);
    if (f) used.set(f.id, f);
  }
  const csv = entriesToCsv(buildGameSchema(unionForms(used.size > 0 ? [...used.values()] : [fallbackForm ?? getBuiltinForm(DEFAULT_FORM_ID)!])), entries, (name) => name, { eventName: currentEventName, includeEvent: true });
  downloadTextFile(`${BRAND.filePrefix}-entries-${teamId}-${Date.now()}.csv`, csv, "text/csv;charset=utf-8");
  await logAuditEvent(teamId, actorUid, actorName, "export-backup", { format: "csv", count: entries.length }, null, null, program);
  return entries.length;
}

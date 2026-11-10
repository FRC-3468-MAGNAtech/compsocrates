"use client";

import { deleteField, doc, getDoc, setDoc } from "firebase/firestore";
import { useMemo } from "react";
import { normalizeEventKey } from "@/config/event";
import { attendanceRecordsFromTeam, attendeesPatch, staleAttendeeKeys } from "@/data/cs/assignments";
import type { CsTeamDoc } from "@/data/cs/types";
import { fetchMemberNames } from "@/lib/assignment-io";
import { db } from "@/lib/firebase/client";
import { useTeamDoc } from "@/lib/team";
import { useTeamMembers } from "@/lib/team-members";

/**
 * Who's attending which event. D1: stored where CS keeps it, `teams/{teamId}.eventAttendees = { [eventKey]: (uid | name)[] }`
 * (CS wrote display names on old docs and uids on new ones; both read, uids are written). There is no per-event document and
 * no timestamp, so `updatedAt` is always null. The CE collection `eventAttendance/{teamId}_{eventCode}` is no longer used.
 */
export type EventAttendance = {
  /** `${teamId}_${eventCode}`. */
  id: string;
  teamId: string;
  eventCode: string;
  uids: string[];
  updatedAt: unknown;
};

/**
 * Admin-gated at the call site (Assignments page) via usePermissions(); also enforced in firestore.rules. A nested merge write of
 * this one event's list: other events, other team fields and any stored entry that is neither a uid nor a member name stay.
 */
export async function setEventAttendance(teamId: string, eventCode: string, uids: string[]): Promise<void> {
  const ref = doc(db, "teams", teamId);
  const [snap, names] = await Promise.all([getDoc(ref), fetchMemberNames(teamId)]);
  const existing = snap.exists() ? (snap.data() as CsTeamDoc).eventAttendees : undefined;
  const members = [...names].map(([uid, name]) => ({ uid, name }));
  const patch = attendeesPatch(existing, eventCode, uids, members);
  // A legacy alias key (`2025lake`) was folded into the canonical key: drop the stale copy so the two cannot disagree.
  const stale = Object.fromEntries(staleAttendeeKeys(existing, eventCode).map((k) => [k, deleteField()]));
  await setDoc(ref, { eventAttendees: { ...patch.eventAttendees, ...stale } }, { merge: true });
}

/** Realtime, every event this team has attendance recorded for — what Scout Accuracy's Event filter and the stats engine read. */
export function useTeamEventAttendance(teamId: string | null) {
  const { team, loaded } = useTeamDoc(teamId);
  const { members } = useTeamMembers(teamId);
  const attendance = useMemo<EventAttendance[]>(
    () => (teamId ? attendanceRecordsFromTeam(teamId, team?.eventAttendees, members.map((m) => ({ uid: m.uid, name: m.name }))) : []),
    [teamId, team?.eventAttendees, members]
  );
  return { attendance, loaded };
}

/** Realtime, one event's attendance — what the Assignments page's own attendance checklist reads/edits. */
export function useEventAttendance(teamId: string | null, eventCode: string | null) {
  const { attendance, loaded } = useTeamEventAttendance(teamId);
  const one = useMemo(() => {
    if (!eventCode) return null;
    const canonical = normalizeEventKey(eventCode);
    return attendance.find((a) => a.eventCode === canonical) ?? null;
  }, [attendance, eventCode]);
  return { attendance: one, loaded };
}

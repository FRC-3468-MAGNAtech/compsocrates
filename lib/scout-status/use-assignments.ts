"use client";

import { onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";
import { normalizeEventKey } from "@/config/event";
import { CS_MATCH_ASSIGNMENTS, csRowsToSlots, isTeamMirrorRow, type CsAssignmentRow } from "@/data/cs/assignments";
import { teamRowsQuery } from "@/lib/assignment-io";
import { isFirebaseConfigured } from "@/lib/firebase/client";
import { reportFirestoreError } from "@/lib/firestore-errors";
import { useProgramConfig } from "@/lib/program/context";
import type { ScheduleSlot } from "@/lib/scheduler/types";

/**
 * Every event's published schedule slots for the team, by event code (TBA key) — one team-scoped query of CS's `matchAssignments`
 * (D1) rather than one read per event; Scout Status looks at several events at once. Team-strategy mirror rows are not match
 * slots and are skipped. Robot positions are not derived here (no schedule is fetched for every event): Scout Status counts a
 * scout's matches, it does not read the slot id.
 */
export function useTeamAssignmentSlots(teamId: string | null): { slotsByEvent: Map<string, ScheduleSlot[]>; loaded: boolean } {
  // A program that has not connected assignments has none: this hook reads the default program's collection only (never another program's).
  const { assignments: connected } = useProgramConfig().connection.features;
  const [slotsByEvent, setSlotsByEvent] = useState<Map<string, ScheduleSlot[]>>(new Map());
  const [loaded, setLoaded] = useState(() => !isFirebaseConfigured());

  useEffect(() => {
    if (!connected || !teamId || !isFirebaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSlotsByEvent(new Map());
      setLoaded(true);
      return;
    }
    const unsubscribe = onSnapshot(
      teamRowsQuery(CS_MATCH_ASSIGNMENTS, teamId),
      (snap) => {
        const byEvent = new Map<string, CsAssignmentRow[]>();
        for (const d of snap.docs) {
          const data = d.data();
          if (isTeamMirrorRow(data)) continue;
          const eventKey = normalizeEventKey(String(data.eventKey ?? ""));
          if (!eventKey) continue;
          byEvent.set(eventKey, [...(byEvent.get(eventKey) ?? []), { id: d.id, data }]);
        }
        setSlotsByEvent(new Map([...byEvent].map(([eventKey, rows]) => [eventKey, csRowsToSlots(rows)])));
        setLoaded(true);
      },
      (err) => {
        reportFirestoreError("matchAssignments (team) subscription failed", err, `${CS_MATCH_ASSIGNMENTS} where teamId == ${teamId}`);
        setSlotsByEvent(new Map());
        setLoaded(true);
      }
    );
    return unsubscribe;
  }, [connected, teamId]);

  return { slotsByEvent, loaded };
}

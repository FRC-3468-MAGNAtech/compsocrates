"use client";

import { collection, onSnapshot, query, where } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db, isFirebaseConfigured } from "@/lib/firebase/client";
import { reportFirestoreError } from "@/lib/firestore-errors";
import { toLeadLog, type LeadLog } from "@/lib/analytics/accuracy-verification";

// Lead scouts' match logs live in `scouting` as rows with `entryType: "lead"` (CS's lead mode of the match form). The scout-entries layer
// skips those rows on purpose, so Accuracy Verification reads them here, with the same query CS runs.

const COLLECTION = "scouting";

export function useLeadMatchLogs(teamId: string | null): { logs: LeadLog[]; loaded: boolean; error: boolean } {
  const [held, setHeld] = useState<{ teamId: string; logs: LeadLog[]; error: boolean } | null>(null);

  useEffect(() => {
    if (!teamId || !isFirebaseConfigured()) return;
    return onSnapshot(
      query(collection(db, COLLECTION), where("teamId", "==", teamId), where("entryType", "==", "lead")),
      (snap) => setHeld({ teamId, logs: snap.docs.flatMap((d) => toLeadLog(d.id, d.data()) ?? []), error: false }),
      (err) => {
        // CS treated a refused lead read as "no lead logs": the verification list is simply empty.
        reportFirestoreError("lead match logs subscription failed", err, `${COLLECTION} where entryType == "lead"`);
        setHeld({ teamId, logs: [], error: true });
      }
    );
  }, [teamId]);

  if (!teamId) return { logs: [], loaded: true, error: false };
  return held?.teamId === teamId ? { logs: held.logs, loaded: true, error: held.error } : { logs: [], loaded: false, error: false };
}

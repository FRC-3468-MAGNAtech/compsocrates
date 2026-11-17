"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db, isFirebaseConfigured } from "@/lib/firebase/client";
import { programPath } from "@/lib/firebase/paths";
import { useProgram } from "@/lib/program/context";
import { fetchTeamCreationEnabled } from "@/lib/team-enrollment";

// Data for the dashboard's admin strip (P13). Mounted only for admins, so none
// of this runs for anyone else (and `auditLog` is admin-read-only in the rules
// anyway).

function toMillis(value: unknown): number {
  if (value && typeof value === "object" && "toMillis" in value && typeof (value as { toMillis: unknown }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  return 0;
}

/**
 * When the team's last backup export happened (Admin Panel > Backups logs one
 * `export-backup` audit entry per download). A narrow query — only that
 * action's entries — rather than the whole audit log the Admin Panel reads.
 * `lastMs` is null when no export has ever been logged.
 */
export function useLastBackup(teamId: string | null): { lastMs: number | null; loaded: boolean } {
  const program = useProgram();
  const [lastMs, setLastMs] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(() => !isFirebaseConfigured());

  useEffect(() => {
    if (!teamId || !isFirebaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoaded(true);
      return;
    }
    const q = query(collection(db, programPath(program, "auditLog")), where("teamId", "==", teamId), where("action", "==", "export-backup"));
    return onSnapshot(
      q,
      (snap) => {
        const times = snap.docs.map((d) => toMillis(d.data().createdAt)).filter((t) => t > 0);
        setLastMs(times.length === 0 ? null : Math.max(...times));
        setLoaded(true);
      },
      (err) => {
        console.error("last backup subscription failed:", err);
        setLastMs(null);
        setLoaded(true);
      }
    );
  }, [teamId, program]);

  return { lastMs, loaded };
}

/** Whether Signup currently offers "Create a team" — the public config route's one boolean (never a direct Firestore read; `appSettings` is denied to clients). `null` while loading. */
export function useTeamCreationEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchTeamCreationEnabled().then((v) => {
      if (!cancelled) setEnabled(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return enabled;
}

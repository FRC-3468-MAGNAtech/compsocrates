"use client";

import { useCallback, useEffect, useState } from "react";
import { getDoc, getDocs, query, where, type DocumentData, type QueryDocumentSnapshot } from "firebase/firestore";
import { db, isFirebaseConfigured } from "@/lib/firebase/client";
import { authedApi } from "@/lib/api-client";
import { programCollection, programDoc } from "@/lib/firebase/paths";
import { PROGRAM_IDS, type ProgramId } from "@/config/programs/types";
import { effectiveStatus, type ApplicationSignals, type ApplicationStatus } from "@/lib/applications";
import type { RoleId } from "@/lib/roles";

/** A `teamApplications` doc as the app reads it (timestamps as milliseconds). */
export type TeamApplication = {
  id: string;
  /** Which program the application is for (the collection it lives in). */
  program: ProgramId;
  applicantUid: string;
  applicantName: string;
  applicantEmail: string;
  teamNumber: number;
  teamName: string;
  officialTeamName: string | null;
  role: RoleId;
  verification: string;
  link: string | null;
  /** As stored. Use `effectiveStatus(app)` for what to show: a pending application past its expiry is expired. */
  status: ApplicationStatus;
  rejectionReason: string | null;
  createdAtMs: number | null;
  expiresAtMs: number | null;
  decidedAtMs: number | null;
  teamId: string | null;
};

export type ApplicationBlock = { id: string; program: ProgramId; type: "email" | "team"; value: string; reason: string | null; createdAtMs: number | null };

const ms = (v: unknown): number | null => (v && typeof v === "object" && "toMillis" in v && typeof (v as { toMillis: unknown }).toMillis === "function" ? (v as { toMillis: () => number }).toMillis() : null);

function toApplication(id: string, program: ProgramId, d: DocumentData): TeamApplication {
  return {
    id,
    program,
    applicantUid: d.applicantUid,
    applicantName: d.applicantName ?? "",
    applicantEmail: d.applicantEmail ?? "",
    teamNumber: d.teamNumber,
    teamName: d.teamName ?? "",
    officialTeamName: d.officialTeamName ?? null,
    role: d.role,
    verification: d.verification ?? "",
    link: d.link ?? null,
    status: d.status,
    rejectionReason: d.rejectionReason ?? null,
    createdAtMs: ms(d.createdAt),
    expiresAtMs: ms(d.expiresAt),
    decidedAtMs: ms(d.decidedAt),
    teamId: d.teamId ?? null,
  };
}

/** What to show for an application right now (expiry is lazy: a pending one past its date is `expired`). */
export function statusOf(app: TeamApplication, nowMs: number = Date.now()): ApplicationStatus {
  return effectiveStatus({ status: app.status, expiresAtMs: app.expiresAtMs }, nowMs);
}

const read = (program: ProgramId, d: QueryDocumentSnapshot<DocumentData>): TeamApplication => toApplication(d.id, program, d.data());
const newestFirst = (a: TeamApplication, b: TeamApplication) => (b.createdAtMs ?? Number.MAX_SAFE_INTEGER) - (a.createdAtMs ?? Number.MAX_SAFE_INTEGER);

/** The signed-in applicant's own applications in the given programs, newest first, in ONE read per program (rules: an applicant reads only their own). No listener. */
export async function fetchMyApplications(uid: string, programs: readonly ProgramId[] = PROGRAM_IDS): Promise<TeamApplication[]> {
  const all = await Promise.all(programs.map(async (program) => ({ program, snap: await getDocs(query(programCollection(db, program, "teamApplications"), where("applicantUid", "==", uid))) })));
  return all.flatMap(({ program, snap }) => snap.docs.map((d) => read(program, d))).sort(newestFirst);
}

/** Own applications, read ONCE when `uid` is known; `refresh()` reads again (after sending one). A failed read shows as none, as before. */
export function useMyApplications(uid: string | null, programs: readonly ProgramId[] = PROGRAM_IDS) {
  const [state, setState] = useState<{ apps: TeamApplication[]; loaded: boolean }>({ apps: [], loaded: !isFirebaseConfigured() });
  const key = programs.join(",");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    if (!uid || !isFirebaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState({ apps: [], loaded: true });
      return;
    }
    fetchMyApplications(uid, key.split(",") as ProgramId[]).then(
      (apps) => alive && setState({ apps, loaded: true }),
      (err) => {
        console.error("teamApplications (own) read failed:", err);
        if (alive) setState({ apps: [], loaded: true });
      }
    );
    return () => {
      alive = false;
    };
  }, [uid, key, attempt]);
  const refresh = useCallback(() => setAttempt((n) => n + 1), []);
  return { applications: state.apps, loaded: state.loaded, refresh };
}

/** Every application in both programs, newest first. Platform owners only (rules). */
export async function fetchAllApplications(): Promise<TeamApplication[]> {
  const all = await Promise.all(PROGRAM_IDS.map(async (program) => ({ program, snap: await getDocs(programCollection(db, program, "teamApplications")) })));
  return all.flatMap(({ program, snap }) => snap.docs.map((d) => read(program, d))).sort(newestFirst);
}

// How many applications are waiting: the badge on the Admin Panel and the sidebar. One read per program, cached for a minute and shared by every caller.
const COUNT_TTL_MS = 60_000;
let countCache: { at: number; promise: Promise<number> } | null = null;
const countListeners = new Set<() => void>();

function pendingCount(): Promise<number> {
  if (countCache && Date.now() - countCache.at < COUNT_TTL_MS) return countCache.promise;
  const promise = Promise.all(PROGRAM_IDS.map((program) => getDocs(query(programCollection(db, program, "teamApplications"), where("status", "==", "pending")))))
    .then((snaps) => {
      const now = Date.now();
      return snaps.flatMap((snap) => snap.docs.map((d) => ms(d.data().expiresAt))).filter((expires) => effectiveStatus({ status: "pending", expiresAtMs: expires }, now) === "pending").length;
    })
    .catch(() => {
      countCache = null;
      return 0;
    });
  countCache = { at: Date.now(), promise };
  return promise;
}

/** Forget the cached count (after a decision) so the badges read again. */
export function refreshPendingApplicationCount(): void {
  countCache = null;
  countListeners.forEach((l) => l());
}

/** The review queue: read ONCE (no listener) when `enabled`; `refresh()` reads again. Platform owners only: pass `enabled: false` for everyone else so nothing is read. */
export function useAllApplications(enabled: boolean) {
  const [state, setState] = useState<{ apps: TeamApplication[]; loaded: boolean; error: boolean }>({ apps: [], loaded: false, error: false });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    if (!enabled || !isFirebaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState({ apps: [], loaded: true, error: false });
      return;
    }
    fetchAllApplications().then(
      (apps) => alive && setState({ apps, loaded: true, error: false }),
      (err) => {
        console.error("teamApplications read failed:", err);
        if (alive) setState({ apps: [], loaded: true, error: true });
      }
    );
    return () => {
      alive = false;
    };
  }, [enabled, attempt]);
  const refresh = useCallback(() => {
    refreshPendingApplicationCount();
    setAttempt((n) => n + 1);
  }, []);
  return { applications: state.apps, loaded: state.loaded, error: state.error, refresh };
}

/** How many applications are waiting (pending and not expired) in both programs: the badge on the Admin Panel. Platform owners only. */
export function usePendingApplicationCount(enabled: boolean): number {
  const [count, setCount] = useState(0);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const again = () => setAttempt((n) => n + 1);
    countListeners.add(again);
    return () => void countListeners.delete(again);
  }, []);
  useEffect(() => {
    let alive = true;
    if (!enabled || !isFirebaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCount(0);
      return;
    }
    void pendingCount().then((n) => alive && setCount(n));
    return () => {
      alive = false;
    };
  }, [enabled, attempt]);
  return count;
}

export type ApplicationPrivate = { signals: ApplicationSignals | null; notes: string };

/** The reviewer-only side of one application (signals, notes), read ONCE when a row is expanded (and again when `version` changes, after a note is saved). */
export function useApplicationPrivate(id: string | null, program: ProgramId, version = 0) {
  const [data, setData] = useState<ApplicationPrivate | null>(null);
  useEffect(() => {
    let alive = true;
    if (!id || !isFirebaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setData(null);
      return;
    }
    getDoc(programDoc(db, program, "applicationPrivate", id)).then(
      (snap) => alive && setData(snap.exists() ? { signals: (snap.data().signals as ApplicationSignals) ?? null, notes: String(snap.data().notes ?? "") } : { signals: null, notes: "" }),
      () => alive && setData({ signals: null, notes: "" })
    );
    return () => {
      alive = false;
    };
  }, [id, program, version]);
  return data;
}

/** The blocks of both programs, read ONCE when `enabled`; `refresh()` reads again. */
export function useApplicationBlocks(enabled: boolean) {
  const [blocks, setBlocks] = useState<ApplicationBlock[]>([]);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    if (!enabled || !isFirebaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBlocks([]);
      return;
    }
    Promise.all(PROGRAM_IDS.map(async (program) => ({ program, snap: await getDocs(programCollection(db, program, "applicationBlocks")) }))).then(
      (all) => alive && setBlocks(all.flatMap(({ program, snap }) => snap.docs.map((d) => ({ id: d.id, program, type: d.data().type, value: String(d.data().value ?? ""), reason: d.data().reason ?? null, createdAtMs: ms(d.data().createdAt) })))),
      () => alive && setBlocks([])
    );
    return () => {
      alive = false;
    };
  }, [enabled, attempt]);
  const refresh = useCallback(() => setAttempt((n) => n + 1), []);
  return { blocks, refresh };
}

// --- calls -----------------------------------------------------------------------------------

export async function fetchStartToken(): Promise<string> {
  const res = await fetch("/api/applications/start", { cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || typeof json.token !== "string") throw new Error("Couldn't start the application form. Refresh and try again.");
  return json.token;
}

export type ApplicationSubmission = {
  /** Which program the team is for. REQUIRED: the first field of the form. */
  program: ProgramId;
  name: string;
  teamNumber: string;
  teamName: string;
  role: string;
  verification: string;
  link: string;
  startToken: string;
  turnstileToken: string | null;
  /** The honeypot: always empty from the real form. */
  orgUrl: string;
};

export function submitApplication(body: ApplicationSubmission): Promise<{ applicationId: string }> {
  return authedApi("/api/applications", { method: "POST", body });
}

export function decideApplication(
  program: ProgramId,
  payload:
    | { action: "approve"; applicationId: string }
    | { action: "reject"; applicationId: string; reason: string }
    | { action: "block"; applicationId: string; blockEmail: boolean; blockTeam: boolean; reason: string }
    | { action: "unblock"; blockId: string }
    | { action: "note"; applicationId: string; notes: string }
): Promise<{ teamId?: string }> {
  return authedApi("/api/admin/applications", { method: "POST", body: { program, ...payload } });
}

export type ApplicationConfig = { turnstileSecretConfigured: boolean; turnstileSiteKeyConfigured: boolean; emailConfigured: boolean };

export function fetchApplicationConfig(): Promise<ApplicationConfig> {
  return authedApi<ApplicationConfig>("/api/admin/application-config");
}

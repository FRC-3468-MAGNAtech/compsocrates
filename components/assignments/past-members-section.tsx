"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, History } from "lucide-react";
import { LoadError } from "@/components/practice/load-error";
import { pastMembersAccess } from "@/components/assignments/past-members-access";
import { Badge } from "@/components/ui/badge";
import { GlassPanel } from "@/components/ui/glass-panel";
import { getDocs, query, where } from "@/lib/firebase/metered";
import { db } from "@/lib/firebase/client";
import { programCollection } from "@/lib/firebase/paths";
import { describeFirestoreError, reportFirestoreError, type FirestoreFailure } from "@/lib/firestore-errors";
import { useAccountState } from "@/lib/account-state";
import { useEventName } from "@/lib/events/use-event-names";
import { useTeamEventAttendance } from "@/lib/event-attendance";
import { useMembershipsEnabled } from "@/lib/memberships/client";
import { readMembership, type MembershipDoc } from "@/lib/memberships/model";
import { MEMBERSHIP_TEXT } from "@/lib/memberships/strings";
import { usePermissions } from "@/lib/permissions";
import { useProgram } from "@/lib/program/context";
import { getRole, normalizeLegacyRole } from "@/lib/roles";

const fmt = (ms: number | null) => (ms && ms > 0 ? new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "unknown");

/**
 * Assignments > Past Team Members: people who left this team or were removed, with the role they had, when they joined and left, and the events they attended
 * (from the attendance lists, which are keyed by uid and never pruned). Collapsed by default, for ACTIVE ADMINS of the team only, and read lazily (the memberships
 * with `teamId ==` and `status == "past"` are fetched the first time the section is opened, once).
 *
 * The read is open only to an admin whose OWN membership of the team is VERIFIED (the rules look at that membership, never at the pointer). An admin whose
 * membership is not verified yet sees the header and a one-line hint instead of data, and nothing is read. Hidden entirely while the memberships switch is OFF.
 */
export function PastMembersSection({ teamId }: { teamId: string }) {
  const enabled = useMembershipsEnabled();
  const { isAdmin } = usePermissions();
  if (!enabled || !isAdmin) return null;
  return <PastMembers teamId={teamId} />;
}

function PastMembers({ teamId }: { teamId: string }) {
  const program = useProgram();
  const state = useAccountState();
  const mine = state.memberships.find((m) => m.teamId === teamId);
  // Mirrors the rule: the reader's own membership of this team is active, an admin one, and VERIFIED (components/assignments/past-members-access.ts).
  const verified = pastMembersAccess({ enabled: true, isAdmin: true, membership: mine }) === "verified";
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<MembershipDoc[] | null>(null);
  const [failure, setFailure] = useState<FirestoreFailure | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open || !verified || (rows !== null && attempt === 0)) return;
    let alive = true;
    const context = "Couldn't load the past team members";
    const path = `${program} memberships where teamId == ${teamId} and status == "past"`;
    getDocs(query(programCollection(db, program, "memberships"), where("teamId", "==", teamId), where("status", "==", "past"))).then(
      (snap) => {
        if (!alive) return;
        setRows(snap.docs.map((d) => readMembership(d.data())).filter((m): m is MembershipDoc => m !== null).sort((a, b) => (b.leftAt ?? 0) - (a.leftAt ?? 0)));
        setFailure(null);
      },
      (err) => {
        if (!alive) return;
        reportFirestoreError(context, err, path);
        setFailure(describeFirestoreError(context, err, path));
        setRows([]);
      }
    );
    return () => {
      alive = false;
    };
  }, [open, verified, rows, attempt, program, teamId]);

  return (
    <GlassPanel className="flex flex-col gap-3" data-testid="past-members">
      <button
        type="button"
        className="flex min-h-11 w-full items-center justify-between gap-3 text-left"
        aria-expanded={open}
        aria-controls="past-members-body"
        onClick={() => setOpen((v) => !v)}
      >
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
          <History className="h-4 w-4" /> {MEMBERSHIP_TEXT.past.heading}
          {rows !== null && rows.length > 0 && ` (${rows.length})`}
        </h2>
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>
      {open && (
        <div id="past-members-body" className="flex flex-col gap-2">
          {!verified ? (
            <p className="text-sm text-[var(--muted-foreground)]" data-testid="past-members-unverified">
              {MEMBERSHIP_TEXT.past.needsVerification}
            </p>
          ) : failure ? (
            <LoadError failure={failure} onRetry={() => { setRows(null); setFailure(null); setAttempt((n) => n + 1); }} />
          ) : rows === null ? (
            <div className="glass-card h-16 animate-pulse" aria-label={MEMBERSHIP_TEXT.past.loading} />
          ) : rows.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">{MEMBERSHIP_TEXT.past.empty}</p>
          ) : (
            <PastList teamId={teamId} rows={rows} />
          )}
        </div>
      )}
    </GlassPanel>
  );
}

/** One past member's events, by name (a tiny component so each code can ask for its own name). */
function EventLabel({ code }: { code: string }) {
  const { displayName } = useEventName(code, {});
  return <Badge variant="glass" className="text-[10px]">{displayName}</Badge>;
}

function PastList({ teamId, rows }: { teamId: string; rows: MembershipDoc[] }) {
  // The attendance lists are read only once the section has data to show.
  const { attendance } = useTeamEventAttendance(teamId);
  const eventsOf = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const m of rows) out.set(m.uid, attendance.filter((a) => a.uids.includes(m.uid)).map((a) => a.eventCode));
    return out;
  }, [rows, attendance]);

  return (
    <ul className="flex flex-col gap-2">
      {rows.map((m) => {
        const role = getRole(m.role ? normalizeLegacyRole(m.role) : "match-scout");
        const events = eventsOf.get(m.uid) ?? [];
        return (
          <li key={m.uid} className="glass-card flex flex-col gap-2 p-4" data-testid={`past-member-${m.uid}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{m.name || "Former member"}</span>
              <Badge className={role.className}>{role.label}</Badge>
              <Badge variant="glass" className="text-[10px]">
                {m.endedBy === "admin" ? MEMBERSHIP_TEXT.past.removedByAdmin : MEMBERSHIP_TEXT.past.leftBySelf}
              </Badge>
            </div>
            <div className="text-xs text-[var(--muted-foreground)]">
              {MEMBERSHIP_TEXT.past.joined} {fmt(m.joinedAt)} · {MEMBERSHIP_TEXT.past.left} {fmt(m.leftAt)}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-[var(--muted-foreground)]">{MEMBERSHIP_TEXT.past.events}:</span>
              {events.length === 0 ? <span className="text-[var(--muted-foreground)]">{MEMBERSHIP_TEXT.past.noEvents}</span> : events.map((code) => <EventLabel key={code} code={code} />)}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

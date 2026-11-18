"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "@/lib/program/navigation";
import { Button } from "@/components/ui/button";
import { TeamSetupCard } from "@/components/auth/team-setup-card";
import { ApplicationStatusCard } from "@/components/applications/application-status-card";
import { useAuth } from "@/lib/auth";
import { useProgram, useProgramConfig } from "@/lib/program/context";
import { membershipApi, useMembershipsEnabled } from "@/lib/memberships/client";
import { MEMBERSHIP_TEXT } from "@/lib/memberships/strings";
import { useMyApplications, type TeamApplication } from "@/lib/applications-client";
import { fetchTeamCreationEnabled } from "@/lib/team-enrollment";
import { cancelJoinRequest, fetchMyJoinRequests, sendJoinRequest, type PendingJoinRequest } from "@/lib/team-setup-client";
import { applicationsState, closedRequestNotice, requestSentText } from "@/lib/team-setup";
import { MAX_PENDING_JOIN_REQUESTS } from "@/config/platform";

export type TeamSetupViewProps = {
  /** Which state to draw. `loading`: the one-time reads have not answered. */
  stage: "loading" | "pending" | "application" | "form";
  programLabel: string;
  greeting?: string;
  /** A person who already has a team asking for another (memberships ON). */
  hasTeam: boolean;
  defaultName: string;
  applications: "open" | "closed" | "loading";
  /** `pending` stage: the requests waiting. `form` stage: the last denied or canceled one shows as a notice. */
  requests: PendingJoinRequest[];
  /** `application` stage. `nowMs` is for tests (a fixed clock); the screen leaves it unset. */
  application: TeamApplication | null;
  nowMs?: number;
  cancelingTeam: string | null;
  cancelError: string | null;
  onCancel: (teamId: string) => void;
  onSendAnother: () => void;
  onApplyAgain: () => void;
  onJoinInstead: () => void;
  onJoin: (input: { code: string; name: string; role?: string }) => Promise<void>;
  joinLookup?: (code: string) => Promise<{ exists: boolean; allowsRoleChoice: boolean; alreadyMember: boolean; atLimit: boolean }>;
  onApply: () => void;
  /** Tests only: the card tab shown first. */
  initialMode?: "join" | "apply";
};

/**
 * What the Join / Apply screen DRAWS, from plain props: the one place its words and layout live. The parity test renders it for both programs in every state with
 * `renderToStaticMarkup` and requires the same markup once the program's label and full name are swapped for placeholders.
 */
export function TeamSetupView(p: TeamSetupViewProps) {
  if (p.stage === "loading") return <div className="glass-card h-64 animate-pulse" />;

  if (p.stage === "pending") {
    const pending = p.requests.filter((r) => r.status === "pending");
    return (
      <div className="glass-card flex flex-col gap-3 p-5 sm:p-6" role="status" data-testid="join-pending">
        <h1 className="text-xl font-semibold">Request sent</h1>
        {pending.map((r) => (
          <div key={r.teamId} className="flex flex-col gap-2">
            <p className="text-sm">{requestSentText(r.teamId)}</p>
            <Button variant="glass" className="min-h-11 w-full" onClick={() => p.onCancel(r.teamId)} disabled={p.cancelingTeam !== null}>
              {p.cancelingTeam === r.teamId ? "Canceling…" : "Cancel request"}
            </Button>
          </div>
        ))}
        {p.cancelError && (
          <p role="alert" className="text-sm text-red-400">
            {p.cancelError}
          </p>
        )}
        {pending.length < MAX_PENDING_JOIN_REQUESTS && (
          <Button variant="glass" className="min-h-11 w-full" onClick={p.onSendAnother}>
            Send another request
          </Button>
        )}
      </div>
    );
  }

  if (p.stage === "application" && p.application) {
    return <ApplicationStatusCard application={p.application} onApplyAgain={p.onApplyAgain} onJoinInstead={p.onJoinInstead} nowMs={p.nowMs} />;
  }

  const closed = p.requests.find((r) => r.status === "denied" || r.status === "canceled");
  return (
    <TeamSetupCard
      programLabel={p.programLabel}
      greeting={p.greeting}
      heading={p.hasTeam ? MEMBERSHIP_TEXT.join.anotherTitle : undefined}
      description={p.hasTeam ? MEMBERSHIP_TEXT.join.anotherBody : undefined}
      applications={p.applications}
      defaultName={p.defaultName}
      notice={closed && (closed.status === "denied" || closed.status === "canceled") ? closedRequestNotice(closed.status) : null}
      onJoin={p.onJoin}
      joinLookup={p.joinLookup}
      onApply={p.onApply}
      initialMode={p.initialMode}
    />
  );
}

/**
 * THE Join / Apply screen, for every program: ONE component, ONE set of words. It is what `/<program>/apply-to-team` shows an account with no team (and, with
 * memberships ON, a person who wants another team); a program supplies only its label (from config) and, through the server, its data. Nothing here asks which
 * program it is serving, and no other component may render the card (`team-setup-parity.test.tsx` and `team-setup-guard.test.ts` beside it).
 *
 * States, in order: loading (one skeleton, until the one-time reads have answered), one or more join requests waiting ("Request sent", each with Cancel, and
 * "Send another request"), an application under review, then the card (Join a team, Apply for a team). Pending requests are read ONCE per visit through
 * `/api/team/my-join-requests` (no listener; the profile subscription the shell already holds is what notices an approval) and again after sending or canceling.
 */
export function TeamSetupScreen({ hasTeam = false, onComplete }: { hasTeam?: boolean; onComplete: () => void }) {
  const program = useProgram();
  const config = useProgramConfig();
  const router = useRouter();
  const { user, profile } = useAuth();
  const memberships = useMembershipsEnabled();
  const { applications, loaded: applicationsLoaded } = useMyApplications(user?.uid ?? null, [program]);
  const [requests, setRequests] = useState<PendingJoinRequest[] | null>(null);
  const [applicationsOpen, setApplicationsOpen] = useState<boolean | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showJoinInstead, setShowJoinInstead] = useState(false);
  const [cancelingTeam, setCancelingTeam] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  // A person who arrived without a team and now has one (an admin approved a request): move on, once.
  const arrivedWithoutTeam = useRef(!profile?.teamId);
  const completed = useRef(false);

  useEffect(() => {
    if (arrivedWithoutTeam.current && profile?.teamId && !completed.current) {
      completed.current = true;
      onComplete();
    }
  }, [profile?.teamId, onComplete]);

  // One read of the person's requests per visit (and per program); a failed read is shown as "none", never as a hang.
  useEffect(() => {
    if (!user) return;
    let alive = true;
    fetchMyJoinRequests(program).then(
      (rows) => alive && setRequests(rows),
      (err) => {
        console.error("join requests read failed:", err);
        if (alive) setRequests([]);
      }
    );
    return () => {
      alive = false;
    };
  }, [user, program]);

  useEffect(() => {
    let alive = true;
    void fetchTeamCreationEnabled().then((open) => alive && setApplicationsOpen(open));
    return () => {
      alive = false;
    };
  }, []);

  if (!user) return null;

  const rows = requests ?? [];
  const pending = rows.filter((r) => r.status === "pending");
  const stage: TeamSetupViewProps["stage"] =
    requests === null || !applicationsLoaded ? "loading" : pending.length > 0 && !showForm ? "pending" : applications.length > 0 && !showJoinInstead && !hasTeam ? "application" : "form";

  const reload = async (optimistic?: PendingJoinRequest) => {
    try {
      setRequests(await fetchMyJoinRequests(program));
    } catch {
      // The request exists on the server; show it from what we know until the next visit.
      if (optimistic) setRequests((current) => [optimistic, ...(current ?? []).filter((r) => r.teamId !== optimistic.teamId)]);
    }
  };

  return (
    <TeamSetupView
      stage={stage}
      programLabel={config.brand.label}
      greeting={user.displayName ? `Hi, ${user.displayName}` : undefined}
      hasTeam={hasTeam}
      defaultName={user.displayName ?? (user.email ?? "").split("@")[0] ?? ""}
      applications={applicationsState(applicationsOpen)}
      requests={rows}
      application={applications[0] ?? null}
      cancelingTeam={cancelingTeam}
      cancelError={cancelError}
      onCancel={async (teamId) => {
        setCancelingTeam(teamId);
        setCancelError(null);
        try {
          await cancelJoinRequest(program, teamId);
          await reload();
        } catch (err) {
          setCancelError(err instanceof Error ? err.message : "Couldn't cancel that request. Try again.");
        } finally {
          setCancelingTeam(null);
        }
      }}
      onSendAnother={() => setShowForm(true)}
      onApplyAgain={() => router.push(`/apply?program=${program}`)}
      onJoinInstead={() => setShowJoinInstead(true)}
      onJoin={async ({ code, name, role }) => {
        const sent = await sendJoinRequest(program, memberships, { code, name, role });
        setShowForm(false);
        await reload({ id: "", teamId: sent.teamId, teamLabel: sent.teamId, role: role ?? "", status: "pending", createdAtMs: Date.now() });
      }}
      joinLookup={memberships ? (code) => membershipApi.joinLookup(program, code) : undefined}
      onApply={() => router.push(`/apply?program=${program}`)}
    />
  );
}

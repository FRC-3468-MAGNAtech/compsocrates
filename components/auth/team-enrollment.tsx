"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Clock, Rocket, Send, UserPlus } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cardEntranceVariants } from "@/lib/motion";
import { useAuth } from "@/lib/auth";
import { createTeam, fetchTeamCreationEnabled, joinTeam, syncRoles, type JoinRequestResult } from "@/lib/team-enrollment";
import { cancelJoinRequest, fetchTeamLabel, useMyJoinRequests } from "@/lib/join-requests-client";
import { isFallbackCodeLabel, type JoinRequest } from "@/data/cs/join-requests";
import { DEFAULT_ROLE_ID, getRole, ROLES, type RoleId } from "@/lib/roles";
import { ApplicationStatusCard } from "@/components/applications/application-status-card";
import { useMyApplications } from "@/lib/applications-client";

/** P20: "apply" is how a team gets an account while public creation is switched off: the applicant goes on to /apply. */
export type EnrollmentMode = "join" | "create" | "apply";

/** What `enroll` did: sent for review (`requested`), created a team (`joinCode`), or hands off to /apply (`apply`). */
export type EnrollResult = { joinCode?: string; apply?: boolean; requested?: JoinRequestResult };

/**
 * Shared Join-a-team / Create-a-team state, used by both the Signup page (inline, alongside name/email/password, for the
 * password path) and <TeamEnrollmentScreen/> below (standalone, for an already-authenticated user with no team yet: Google
 * sign-in's first-time path, or anyone who closed the tab before finishing).
 *
 * Joining is CS's approval queue: `enroll` in "join" mode files a join request (the user is NOT on the team until an admin
 * approves it). `teamCreationEnabled` is `null` while that's still loading, during which the Create tab is hidden and Join is assumed.
 */
export function useTeamEnrollment() {
  const [mode, setMode] = useState<EnrollmentMode>("join");
  const [joinCode, setJoinCode] = useState("");
  const [role, setRole] = useState<RoleId>(DEFAULT_ROLE_ID);
  const [teamNumber, setTeamNumber] = useState("");
  const [teamName, setTeamName] = useState("");
  const [teamCreationEnabled, setTeamCreationEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchTeamCreationEnabled().then((enabled) => {
      if (!cancelled) setTeamCreationEnabled(enabled);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const enroll = async (name?: string): Promise<EnrollResult> => {
    if (mode === "apply" && teamCreationEnabled === false) return { apply: true };
    if (mode === "join" || !teamCreationEnabled) {
      if (!joinCode.trim()) throw new Error("Enter a join code.");
      const requested = await joinTeam(joinCode.trim(), { name, role });
      return { requested };
    }
    const parsedNumber = Number(teamNumber);
    if (!Number.isInteger(parsedNumber) || parsedNumber <= 0) {
      throw new Error("Enter a valid team number.");
    }
    const result = await createTeam(parsedNumber, teamName.trim() || undefined, name, role);
    return { joinCode: result.joinCode };
  };

  return {
    mode,
    setMode,
    joinCode,
    setJoinCode,
    role,
    setRole,
    teamNumber,
    setTeamNumber,
    teamName,
    setTeamName,
    teamCreationEnabled,
    enroll,
  };
}

export function TeamEnrollmentFields({ enrollment }: { enrollment: ReturnType<typeof useTeamEnrollment> }) {
  const { mode, setMode, joinCode, setJoinCode, role, setRole, teamNumber, setTeamNumber, teamName, setTeamName, teamCreationEnabled } = enrollment;
  const showCreateFields = teamCreationEnabled && mode === "create";
  // P20: with public creation off, the second option is applying (reviewed by the platform owner), not creating.
  const showApply = teamCreationEnabled === false && mode === "apply";

  const roleField = (
    <div>
      <Label htmlFor="enroll-role">Your role</Label>
      <Select value={role} onValueChange={(v) => setRole(v as RoleId)}>
        <SelectTrigger id="enroll-role" className="h-12">
          <SelectValue>{getRole(role).label}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {ROLES.map((r) => (
            <SelectItem key={r.id} value={r.id} className="py-2.5">
              {r.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {teamCreationEnabled && (
        <Tabs value={mode} onValueChange={(v) => setMode(v as EnrollmentMode)}>
          <TabsList>
            <TabsTrigger value="join">Join a team</TabsTrigger>
            <TabsTrigger value="create">Create a team</TabsTrigger>
          </TabsList>
        </Tabs>
      )}
      {teamCreationEnabled === false && (
        <Tabs value={mode === "apply" ? "apply" : "join"} onValueChange={(v) => setMode(v as EnrollmentMode)}>
          <TabsList>
            <TabsTrigger value="join">Join a team</TabsTrigger>
            <TabsTrigger value="apply">Apply to create a team</TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      {showApply ? (
        <p className="glass-card rounded-xl p-3.5 text-sm text-[var(--muted-foreground)]" data-testid="apply-explainer">
          New team accounts are approved by hand, one per team. Next you&apos;ll verify your email and tell us about your team. If your team already has an account, ask your team admin for its join code instead.
        </p>
      ) : showCreateFields ? (
        <>
          <div>
            <Label htmlFor="team-number">Team number</Label>
            <Input id="team-number" inputMode="numeric" value={teamNumber} onChange={(e) => setTeamNumber(e.target.value)} placeholder="12345" required />
          </div>
          <div>
            <Label htmlFor="team-name">Team name (optional)</Label>
            <Input id="team-name" value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="Team name" />
          </div>
          {roleField}
        </>
      ) : (
        <>
          <div>
            <Label htmlFor="join-code">Team join code</Label>
            <Input
              id="join-code"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="Ask your team admin"
              autoCapitalize="characters"
              autoComplete="off"
              required
            />
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">You&apos;ll need admin approval to join the team.</p>
          </div>
          {roleField}
        </>
      )}
    </div>
  );
}

const fmtDate = (ms: number) => (ms > 0 ? new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "just now");

/**
 * The requester's "waiting for approval" state (CS dashboard's pending-request card): which team, which role, when, and a way to
 * cancel. The team label comes from the request (`teamDisplayLabel`), else the server label lookup (`/api/team/label`), which
 * needs no client rule, else "Team CODE".
 */
export function PendingJoinCard({
  teamId,
  teamLabel,
  role,
  createdAtMs,
  onCancel,
  canceling,
  error,
}: {
  teamId: string;
  teamLabel: string;
  role: RoleId;
  createdAtMs: number;
  onCancel: () => void;
  canceling: boolean;
  error: string | null;
}) {
  const [resolved, setResolved] = useState<string | null>(null);
  const needsLookup = isFallbackCodeLabel(teamLabel, teamId);

  useEffect(() => {
    if (!needsLookup) return;
    let cancelled = false;
    fetchTeamLabel(teamId).then((found) => {
      if (!cancelled && found?.exists && found.label) setResolved(found.label);
    });
    return () => {
      cancelled = true;
    };
  }, [needsLookup, teamId]);

  const label = needsLookup ? resolved ?? `Team ${teamId}` : teamLabel;
  return (
    <GlassPanel strong className="flex flex-col gap-5" data-testid="join-pending">
      <div className="flex items-start gap-3">
        <Clock className="mt-0.5 h-6 w-6 shrink-0 text-sky-300" />
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">Waiting for approval</h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            You asked to join <strong className="text-[var(--foreground)]">{label}</strong>.
          </p>
        </div>
        <Badge variant="glass" className="ml-auto shrink-0">
          Pending
        </Badge>
      </div>
      <p className="text-sm">
        A team admin needs to approve your request. You can close this page: it will be here whenever you sign in, and you&apos;ll go straight to your dashboard once you&apos;re approved.
      </p>
      <p className="text-xs text-[var(--muted-foreground)]">
        Sent {fmtDate(createdAtMs)} as {getRole(role).label}. Code {teamId}.
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      <Button variant="glass" className="min-h-11" onClick={onCancel} disabled={canceling}>
        {canceling ? "Canceling…" : "Cancel request"}
      </Button>
    </GlassPanel>
  );
}

/**
 * The full "you're signed in, now join or create a team" screen: used standalone by /finish-setup, and rendered in place of
 * Signup's pre-auth form once a Google sign-in there has no team yet. States, in order: on a team (leave for the dashboard), a
 * join request waiting for an admin, an application under review, then the form.
 */
export function TeamEnrollmentScreen({
  greeting,
  onComplete,
}: {
  greeting?: string;
  /** Called once the account has a team (create succeeded, or an admin approved the request): the caller decides where to go, e.g. router.push("/dashboard"). */
  onComplete: () => void;
}) {
  const router = useRouter();
  const { logout, profile, user } = useAuth();
  const enrollment = useTeamEnrollment();
  const { requests, loaded: requestsLoaded } = useMyJoinRequests(user?.uid ?? null);
  // P20: anyone who has applied sees their Application status here whenever they sign in, instead of the join form.
  const { applications, loaded: applicationsLoaded } = useMyApplications(user?.uid ?? null);
  const [showJoinInstead, setShowJoinInstead] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdJoinCode, setCreatedJoinCode] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  // The request just sent: shown at once, before the realtime listener delivers the row.
  const [justRequested, setJustRequested] = useState<{ id: string | null; teamId: string; label: string; role: RoleId; atMs: number } | null>(null);
  const [canceling, setCanceling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [continued, setContinued] = useState(false);
  const syncedApproval = useRef(false);

  const hasTeam = Boolean(profile?.teamId);
  const pending: JoinRequest | undefined = requests.find((r) => r.status === "pending");
  const approvedUnsynced = requests.find((r) => r.status === "approved" && r.profileSyncPending);
  const lastClosed = requests.find((r) => r.status === "denied" || r.status === "canceled");

  // Approved (the profile now has a team): go on, unless a create is still in flight or the creator is still looking at the
  // join code they were just shown (the profile can arrive a moment before the response does).
  useEffect(() => {
    if (hasTeam && !submitting && (!createdJoinCode || continued)) onComplete();
  }, [hasTeam, submitting, createdJoinCode, continued, onComplete]);

  // An approval whose profile write never landed (legacy CS approvals): the server applies it at sign-in sync.
  useEffect(() => {
    if (!approvedUnsynced || hasTeam || syncedApproval.current) return;
    syncedApproval.current = true;
    void syncRoles();
  }, [approvedUnsynced, hasTeam]);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      const result = await enrollment.enroll();
      if (result.apply) {
        router.push("/apply");
        return;
      }
      if (result.joinCode) {
        setCreatedJoinCode(result.joinCode);
      } else if (result.requested) {
        setJustRequested({ id: result.requested.requestId, teamId: result.requested.teamId, label: result.requested.teamLabel, role: enrollment.role, atMs: Date.now() });
      }
      setSubmitting(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  };

  const handleCancel = async (requestId: string | null) => {
    if (!requestId) return;
    setCanceling(true);
    setCancelError(null);
    try {
      await cancelJoinRequest(requestId);
      setJustRequested(null);
      setNotice("Request canceled. You can ask to join a different team below.");
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : "Couldn't cancel that request. Try again.");
    } finally {
      setCanceling(false);
    }
  };

  const shell = (children: React.ReactNode, width = "max-w-md") => (
    <div className="flex min-h-[70vh] items-center justify-center py-16">
      <motion.div variants={cardEntranceVariants} initial="hidden" animate="show" className={`w-full ${width}`}>
        {children}
      </motion.div>
    </div>
  );

  if (createdJoinCode) {
    return shell(
      <GlassPanel strong className="flex flex-col gap-6 text-center">
        <div>
          <h1 className="text-2xl font-semibold">Team created</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">Share this join code with the rest of the team. They sign up with it, and you approve them in Team Management.</p>
        </div>
        <div className="glass-card rounded-xl px-6 py-4 font-mono text-3xl font-bold tracking-[0.3em]">{createdJoinCode}</div>
        <Button size="lg" onClick={() => setContinued(true)} disabled={continued}>
          {continued ? "Setting up…" : "Continue to dashboard"}
        </Button>
      </GlassPanel>,
      "max-w-sm"
    );
  }

  if (!requestsLoaded || !applicationsLoaded) return shell(<div className="glass-card h-64 animate-pulse" />);

  const showPending = pending
    ? { id: pending.id, teamId: pending.teamId, label: pending.teamDisplayLabel, role: pending.requestedRole, atMs: pending.createdAtMs }
    : justRequested;
  if (showPending) {
    return shell(
      <PendingJoinCard
        teamId={showPending.teamId}
        teamLabel={showPending.label}
        role={showPending.role}
        createdAtMs={showPending.atMs}
        onCancel={() => void handleCancel(showPending.id)}
        canceling={canceling}
        error={cancelError}
      />
    );
  }

  if (applications.length > 0 && !showJoinInstead) {
    return shell(<ApplicationStatusCard application={applications[0]} onApplyAgain={() => router.push("/apply")} onJoinInstead={() => setShowJoinInstead(true)} />);
  }

  return shell(
    <GlassPanel strong className="flex flex-col gap-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Almost there</h1>
        {greeting && <p className="mt-1 text-sm font-medium">{greeting}</p>}
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">Ask to join your team with its code. A team admin approves you.</p>
      </div>

      {(notice || lastClosed) && (
        <p role="status" className="glass-card rounded-xl p-3 text-sm" data-testid="join-closed-note">
          {notice ?? (lastClosed?.status === "denied" ? "Your last join request was denied. Check the code with your team admin and try again." : "You canceled your last join request.")}
        </p>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <TeamEnrollmentFields enrollment={enrollment} />
        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" className="mt-1 min-h-11 gap-2" disabled={submitting}>
          {enrollment.mode === "apply" && enrollment.teamCreationEnabled === false ? (
            <Send className="h-4 w-4" />
          ) : enrollment.mode === "create" && enrollment.teamCreationEnabled ? (
            <Rocket className="h-4 w-4" />
          ) : (
            <UserPlus className="h-4 w-4" />
          )}
          {submitting
            ? "Working…"
            : enrollment.mode === "apply" && enrollment.teamCreationEnabled === false
              ? "Continue to application"
              : enrollment.mode === "create" && enrollment.teamCreationEnabled
                ? "Create team"
                : "Request to join"}
        </Button>
      </form>

      <p className="text-center text-sm text-[var(--muted-foreground)]">
        Wrong account?{" "}
        <button
          type="button"
          onClick={handleLogout}
          disabled={loggingOut}
          className="inline-flex min-h-11 items-center font-medium text-[var(--foreground)] underline underline-offset-4 disabled:opacity-60"
        >
          {loggingOut ? "Logging out…" : "Log out"}
        </button>
      </p>
    </GlassPanel>,
    "max-w-sm"
  );
}

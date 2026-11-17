"use client";

import { useEffect, useState } from "react";
import { notFound, useParams } from "next/navigation";
import { usePathname, useRouter } from "@/lib/program/navigation";
import { isProgramId, type ProgramId } from "@/config/programs/types";
import { isPathConnected, PROGRAMS } from "@/config/programs";
import { ProgramProvider, useProgram, useProgramConfig } from "@/lib/program/context";
import { useProgramData } from "@/lib/program/data";
import { ProgramGate } from "@/components/program/program-gate";
import { ProgramSetupFrame } from "@/components/program/setup-frame";
import { TeamEnrollmentScreen } from "@/components/auth/team-enrollment";
import { ProgramAuth } from "@/components/program/program-auth";
import { ReadFailureBanner } from "@/components/program/read-failure-banner";
import { UnconnectedPage } from "@/components/program/unconnected-page";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { PageTransition } from "@/components/layout/page-transition";
import { VerifyEmailBanner } from "@/components/layout/verify-email-banner";
import { LibraryBackfill } from "@/components/admin/library-backfill";
import { SiteFooter } from "@/components/layout/site-footer";
import { LiveMatchPill } from "@/components/layout/live-match-pill";
import { ScoresReadyWatcher } from "@/components/layout/scores-ready-watcher";
import { TeamAssignmentsWatcher } from "@/components/layout/team-assignments-watcher";
import { useAuth } from "@/lib/auth";
import { useConnectionNotice } from "@/lib/use-connection-state";
import { OurTeamProvider } from "@/lib/our-team";
import { PageGuard } from "@/components/page-access/page-guard";
import { PageAccessProvider } from "@/lib/page-access/store";
import { SidebarConfigProvider } from "@/lib/sidebar/store";
import { FormsProvider } from "@/lib/forms/forms-context";
import { OwnershipTransferBanner } from "@/components/layout/ownership-transfer-banner";
import { JoinAnotherTeam } from "@/components/team/join-another-team";
import { useMembershipsEnabled } from "@/lib/memberships/client";
import { TeamSwitchProvider, isHolding, useTeamSwitch } from "@/lib/memberships/switching";
import { MEMBERSHIP_TEXT } from "@/lib/memberships/strings";
import { ImmersiveContext, useImmersiveValue } from "@/lib/shell-immersive";

function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // P24: the practice workspace's Focus mode hides the sidebar and the mobile top bar (lib/shell-immersive.tsx).
  const [immersive, setImmersive] = useState(false);
  const immersiveValue = useImmersiveValue(immersive, setImmersive);
  const router = useRouter();
  const { user, profile, loading } = useAuth();
  const program = useProgram();
  const pathname = usePathname();
  // A program with its own data port (not the root program) has its own profile and team, and only the features it has connected.
  const ported = useProgramData() !== null;
  const config = useProgramConfig();
  const { features } = config.connection;
  // One subscription for the offline / unsynced badge, shared by the sidebar and the mobile top bar.
  const connection = useConnectionNotice();
  // Memberships (kill switch): ON, a person with a team may open the join screen again, and a team switch holds the shell on "Switching…" until the new team shows up.
  const memberships = useMembershipsEnabled();
  const { target: switchTarget } = useTeamSwitch();
  // Both programs send an account with no team to the same place, `/<program>/apply-to-team`: the root program's own join-or-create screen, or a program
  // with a data port's setup screen (create a team, or ask to join with a code). Once the account has a team, that route goes on to the dashboard.
  const onSetupRoute = pathname === "/apply-to-team";
  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/login");
    else if (!profile?.teamId && !onSetupRoute) router.replace("/apply-to-team");
    else if (profile?.teamId && onSetupRoute && !memberships) router.replace("/dashboard");
  }, [loading, user, profile, router, onSetupRoute, memberships]);

  // A team switch is in progress: nothing of the old team (pages, forms, permissions) stays on screen while the new team id arrives.
  if (isHolding(switchTarget, profile?.teamId)) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3" role="status" data-testid="team-switching">
        <div className="glass-card h-10 w-10 animate-pulse rounded-full" />
        <p className="text-sm text-[var(--muted-foreground)]">{MEMBERSHIP_TEXT.switcher.switching}</p>
      </div>
    );
  }

  // (An account that already has a team and lands on the setup route sees the spinner while the effect above moves it to the dashboard.)
  if (loading || !user || !profile?.teamId || (onSetupRoute && !memberships)) {
    if (!loading && user && onSetupRoute && !profile?.teamId) {
      return ported ? (
        <ProgramGate />
      ) : (
        <ProgramSetupFrame>
          <TeamEnrollmentScreen embedded programLabel={config.brand.label} greeting={user.displayName ? `Hi, ${user.displayName}` : undefined} onComplete={() => router.push("/dashboard")} />
        </ProgramSetupFrame>
      );
    }
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <div className="glass-card h-10 w-10 animate-pulse rounded-full" />
      </div>
    );
  }

  return (
    // One shared subscription to the team doc (our team's number and name) for the whole signed-in app.
    <OurTeamProvider key={profile.teamId}>
      {/* P26: one shared subscription to the account's page access, for the nav, the route guard and the permissions. */}
      <PageAccessProvider>
      {/* Session F: the team's sidebar layout (cached on the device, live from Firestore), read by the sidebar through lib/sidebar/resolve.ts. */}
      <SidebarConfigProvider>
      <FormsProvider>
      <ImmersiveContext.Provider value={immersiveValue}>
      <div className="mx-auto flex w-full max-w-[1600px] gap-4 px-3 pb-6 pt-4 lg:px-6">
        {!immersive && <Sidebar mobileOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} connection={connection} />}
        <div className="min-w-0 flex-1">
          {!immersive && <Topbar onMenuClick={() => setMobileNavOpen(true)} connection={connection} />}
          <main className="min-w-0">
            <VerifyEmailBanner className="mb-4" />
            <OwnershipTransferBanner className="mb-4" />
            <ReadFailureBanner className="mb-4" />
            {features.live && <LiveMatchPill />}
            <PageTransition>
              {/* A path whose data layer is not connected for this program shows a notice, never the shared page (it would read another program's data). */}
              {onSetupRoute ? <JoinAnotherTeam /> : isPathConnected(program, pathname) ? <PageGuard>{children}</PageGuard> : <UnconnectedPage />}
            </PageTransition>
          </main>
          <SiteFooter className="mt-10" />
        </div>
        {features.practice && features.live && <ScoresReadyWatcher />}
        {features.assignments && <TeamAssignmentsWatcher />}
        {profile.isAdmin && features.library && <LibraryBackfill />}
      </div>
      </ImmersiveContext.Provider>
      </FormsProvider>
      </SidebarConfigProvider>
      </PageAccessProvider>
    </OurTeamProvider>
  );
}

export default function ProgramLayout({ children }: { children: React.ReactNode }) {
  const { program } = useParams<{ program: string }>();
  if (!isProgramId(program)) notFound();
  return (
    <ProgramProvider program={program}>
      <ProgramRoute program={program}>{children}</ProgramRoute>
    </ProgramProvider>
  );
}

/** Connected programs get the full shell; the others get the gate (see ProgramConfig.pagesConnected). */
function ProgramRoute({ program, children }: { program: ProgramId; children: React.ReactNode }) {
  return PROGRAMS[program].pagesConnected ? (
    <ProgramAuth>
      <TeamSwitchProvider>
        <AppShell>{children}</AppShell>
      </TeamSwitchProvider>
    </ProgramAuth>
  ) : (
    <ProgramGate />
  );
}

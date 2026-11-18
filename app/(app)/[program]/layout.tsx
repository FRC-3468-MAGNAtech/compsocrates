"use client";

import { useEffect, useState } from "react";
import { notFound, useParams } from "next/navigation";
import { usePathname, useRouter } from "@/lib/program/navigation";
import { isProgramId, type ProgramId } from "@/config/programs/types";
import { isPathConnected, PROGRAMS } from "@/config/programs";
import { ProgramProvider, useProgram, useProgramConfig } from "@/lib/program/context";
import { ProgramGate } from "@/components/program/program-gate";
import { ProgramSetupFrame } from "@/components/program/setup-frame";
import { TeamSetupScreen } from "@/components/team-setup/team-setup-screen";
import { ProgramAuth } from "@/components/program/program-auth";
import { ReadFailureBanner } from "@/components/program/read-failure-banner";
import { QuotaBanner } from "@/components/layout/quota-banner";
import { UnconnectedPage } from "@/components/program/unconnected-page";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { PageTransition } from "@/components/layout/page-transition";
import { VerifyEmailBanner } from "@/components/layout/verify-email-banner";
import { LibraryBackfill } from "@/components/admin/library-backfill";
import { SiteFooter } from "@/components/layout/site-footer";
import { LiveMatchPill } from "@/components/layout/live-match-pill";
import { ScoresReadyWatcher } from "@/components/layout/scores-ready-watcher";
import { ReadMeterBridge } from "@/components/layout/read-meter-bridge";
import { showsLivePill } from "@/lib/live/pill-pages";
import { TeamAssignmentsWatcher } from "@/components/layout/team-assignments-watcher";
import { useAuth } from "@/lib/auth";
import { useConnectionNotice } from "@/lib/use-connection-state";
import { OurTeamProvider } from "@/lib/our-team";
import { PageGuard } from "@/components/page-access/page-guard";
import { PageAccessProvider } from "@/lib/page-access/store";
import { SidebarConfigProvider } from "@/lib/sidebar/store";
import { FormsProvider } from "@/lib/forms/forms-context";
import { OwnershipTransferBanner } from "@/components/layout/ownership-transfer-banner";
import { useMembershipsEnabled, useMembershipsSettled } from "@/lib/memberships/client";
import { resolveShellRoute } from "@/lib/personal/routing";
import { setPersonalScope } from "@/lib/personal/scope";
import { PersonalModeContext } from "@/lib/personal/context";
import { usePlatformOwnerClaimState } from "@/lib/use-platform-owner-claim";
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
  const config = useProgramConfig();
  const { features } = config.connection;
  // One subscription for the offline / unsynced badge, shared by the sidebar and the mobile top bar.
  const connection = useConnectionNotice();
  // Memberships (kill switch): ON, a person with a team may open the join screen again, a person with NO team lives in the limited personal shell, and a team switch
  // holds the shell on "Switching…" until the new team shows up.
  const memberships = useMembershipsEnabled();
  const membershipsSettled = useMembershipsSettled();
  const { target: switchTarget } = useTeamSwitch();
  const { claim: ownerClaim, ready: ownerClaimReady } = usePlatformOwnerClaimState();
  const isPlatformOwner = (profile?.isPlatformOwner ?? false) || ownerClaim;
  // ONE rule for where an account may be (lib/personal/routing.ts, tested exhaustively): OFF, no team means the setup screen at `/<program>/apply-to-team`, the same
  // screen in both programs; ON, no team means the personal shell and its own pages. A person with a team on the setup route goes on to the dashboard unless ON.
  const onSetupRoute = pathname === "/apply-to-team";
  const route = resolveShellRoute({
    loaded: !loading,
    signedIn: !!user,
    hasTeam: !!profile?.teamId,
    memberships,
    // Wait for both answers (the switch and the owner claim) before routing a person who has no team: a guess would bounce a deep link to the dashboard.
    membershipsKnown: membershipsSettled && ownerClaimReady,
    pathname,
    isPlatformOwner,
  });
  useEffect(() => {
    if (route.redirect) router.replace(route.redirect);
  }, [route.redirect, router]);
  // Personal mode tells the practice and entry writers to work in the person's private path (lib/personal/scope.ts). Set in render, here at the top of the shell, so it is
  // in place before any child effect asks; cleared the moment the account has a team.
  setPersonalScope(route.render === "personal" && user ? user.uid : null);

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
  if (route.render === "setup") {
    return (
      <ProgramSetupFrame>
        <TeamSetupScreen onComplete={() => router.push("/dashboard")} />
      </ProgramSetupFrame>
    );
  }
  if (route.render === "loading") {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <div className="glass-card h-10 w-10 animate-pulse rounded-full" />
      </div>
    );
  }
  const personal = route.render === "personal";
  const teamKey = profile?.teamId ?? "personal";

  return (
    // One shared subscription to the team doc (our team's number and name) for the whole signed-in app.
    <PersonalModeContext.Provider value={{ personal, isPlatformOwner }}>
    <OurTeamProvider key={teamKey}>
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
            <QuotaBanner className="mb-4" />
            <ReadFailureBanner className="mb-4" />
            {features.live && !personal && showsLivePill(pathname) && <LiveMatchPill />}
            <PageTransition>
              {/* The setup route shows the one Join / Apply screen. A path whose data layer is not connected for this program shows a notice, never the shared page (it
                  would read another program's data). In the personal shell only the personal pages are reachable (the route above), so the team page guard is skipped. */}
              {onSetupRoute ? (
                <div className="mx-auto max-w-xl">
                  <TeamSetupScreen hasTeam={!personal} onComplete={() => router.push("/dashboard")} />
                </div>
              ) : isPathConnected(program, pathname) ? (
                personal ? (
                  children
                ) : (
                  <PageGuard>{children}</PageGuard>
                )
              ) : (
                <UnconnectedPage />
              )}
            </PageTransition>
          </main>
          <SiteFooter className="mt-10" />
        </div>
        <ReadMeterBridge />
        {features.practice && features.live && !personal && <ScoresReadyWatcher />}
        {features.assignments && !personal && <TeamAssignmentsWatcher />}
        {profile?.isAdmin && features.library && !personal && <LibraryBackfill />}
      </div>
      </ImmersiveContext.Provider>
      </FormsProvider>
      </SidebarConfigProvider>
      </PageAccessProvider>
    </OurTeamProvider>
    </PersonalModeContext.Provider>
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

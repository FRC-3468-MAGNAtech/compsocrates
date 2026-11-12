"use client";

import { useEffect, useState } from "react";
import { notFound, useParams } from "next/navigation";
import { useRouter } from "@/lib/program/navigation";
import { isProgramId, type ProgramId } from "@/config/programs/types";
import { PROGRAMS } from "@/config/programs";
import { ProgramProvider } from "@/lib/program/context";
import { ProgramGate } from "@/components/program/program-gate";
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
import { FormsProvider } from "@/lib/forms/forms-context";
import { OwnershipTransferBanner } from "@/components/layout/ownership-transfer-banner";
import { ImmersiveContext, useImmersiveValue } from "@/lib/shell-immersive";

function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // P24: the practice workspace's Focus mode hides the sidebar and the mobile top bar (lib/shell-immersive.tsx).
  const [immersive, setImmersive] = useState(false);
  const immersiveValue = useImmersiveValue(immersive, setImmersive);
  const router = useRouter();
  const { user, profile, loading } = useAuth();
  // One subscription for the offline / unsynced badge, shared by the sidebar and the mobile top bar.
  const connection = useConnectionNotice();
  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/login");
    // Signed in but no user doc yet (first-time Google sign-in, or anyone
    // who closed the tab before finishing).
    // CS user docs exist from signup with `teamId: ""` (a pending join request): same destination, which shows the pending state.
    else if (!profile?.teamId) router.replace("/finish-setup");
  }, [loading, user, profile, router]);

  if (loading || !user || !profile?.teamId) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <div className="glass-card h-10 w-10 animate-pulse rounded-full" />
      </div>
    );
  }

  return (
    // One shared subscription to the team doc (our team's number and name) for the whole signed-in app.
    <OurTeamProvider>
      {/* P26: one shared subscription to the account's page access, for the nav, the route guard and the permissions. */}
      <PageAccessProvider>
      <FormsProvider>
      <ImmersiveContext.Provider value={immersiveValue}>
      <div className="mx-auto flex w-full max-w-[1600px] gap-4 px-3 pb-6 pt-4 lg:px-6">
        {!immersive && <Sidebar mobileOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} connection={connection} />}
        <div className="min-w-0 flex-1">
          {!immersive && <Topbar onMenuClick={() => setMobileNavOpen(true)} connection={connection} />}
          <main className="min-w-0">
            <VerifyEmailBanner className="mb-4" />
            <OwnershipTransferBanner className="mb-4" />
            <LiveMatchPill />
            <PageTransition>
              <PageGuard>{children}</PageGuard>
            </PageTransition>
          </main>
          <SiteFooter className="mt-10" />
        </div>
        <ScoresReadyWatcher />
        <TeamAssignmentsWatcher />
        {profile.isAdmin && <LibraryBackfill />}
      </div>
      </ImmersiveContext.Provider>
      </FormsProvider>
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
  return PROGRAMS[program].pagesConnected ? <AppShell>{children}</AppShell> : <ProgramGate />;
}

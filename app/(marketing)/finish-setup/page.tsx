"use client";

import { useEffect } from "react";
import { useRouter } from "@/lib/program/navigation";
import { useAuth } from "@/lib/auth";
import { useProgramData } from "@/lib/program/data";
import { TeamEnrollmentScreen } from "@/components/auth/team-enrollment";

/**
 * Lands a signed-in user with no team yet here: a first-time Google sign-in (no profile doc), a password signup whose join
 * request is waiting for an admin (a CS profile with `teamId: ""`, which this page shows as "Waiting for approval"), or a
 * denied/canceled request that needs another try. CS's no-team join flow lives here (docs/ROUTES.md: `/dashboard` -> `/finish-setup`).
 *
 * That flow is the root program's (its server routes and its teams). When the program in use has its own data port, the person's profile and team
 * live under that program, so they are sent to that program's dashboard, where its own setup screen (create a team, or ask to join with a code) runs.
 */
export default function FinishSetupPage() {
  const router = useRouter();
  const { user, profile, loading } = useAuth();
  const ported = useProgramData() !== null;

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/login");
    else if (profile?.teamId || ported) router.replace("/dashboard");
  }, [loading, user, profile, ported, router]);

  if (loading || !user || profile?.teamId || ported) return null;

  return <TeamEnrollmentScreen greeting={user.displayName ? `Hi, ${user.displayName}` : undefined} onComplete={() => router.push("/dashboard")} />;
}

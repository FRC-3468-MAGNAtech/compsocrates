"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { TeamEnrollmentScreen } from "@/components/auth/team-enrollment";

/**
 * Lands a signed-in user with no team yet here: a first-time Google sign-in (no profile doc), a password signup whose join
 * request is waiting for an admin (a CS profile with `teamId: ""`, which this page shows as "Waiting for approval"), or a
 * denied/canceled request that needs another try. CS's no-team join flow lives here (docs/ROUTES.md: `/dashboard` -> `/finish-setup`).
 */
export default function FinishSetupPage() {
  const router = useRouter();
  const { user, profile, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/login");
    else if (profile?.teamId) router.replace("/dashboard");
  }, [loading, user, profile, router]);

  if (loading || !user || profile?.teamId) return null;

  return <TeamEnrollmentScreen greeting={user.displayName ? `Hi, ${user.displayName}` : undefined} onComplete={() => router.push("/dashboard")} />;
}

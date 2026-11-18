"use client";

import { useEffect, useState } from "react";
import { onSnapshot } from "@/lib/firebase/metered";
import { db, isFirebaseConfigured } from "@/lib/firebase/client";
import { programDoc, programPath } from "@/lib/firebase/paths";
import { failureDetails, reportFirestoreError } from "@/lib/firestore-errors";
import { useAuth } from "@/lib/auth";
import { useRouter } from "@/lib/program/navigation";
import { useProgram, useProgramConfig } from "@/lib/program/context";
import { ProgramSetupFrame } from "@/components/program/setup-frame";
import { TeamSetupScreen } from "@/components/team-setup/team-setup-screen";

type Membership = "loading" | "none" | "left" | "member" | { error: string };

/**
 * What a program profile snapshot means for the team gate. A profile whose `teamId` is empty (a person who left their only team keeps the profile and its
 * preferences) is NOT a member: it gets the setup screen, like an account with no profile at all ("left" only tells the setup screen the profile exists).
 */
export function membershipOfProfile(exists: boolean, data: { teamId?: unknown } | undefined): "none" | "left" | "member" {
  if (!exists) return "none";
  return typeof data?.teamId === "string" && data.teamId.trim() !== "" ? "member" : "left";
}

/**
 * The signed-in shell for a program whose data layer is not wired into the shared pages yet. It reads the account's
 * membership in this program (`<program prefix>users/{uid}`), shows its state and the program selector, and does NOT render
 * the shared pages: they would read the FRC collections and show FRC data inside another program.
 * When a program's pages are connected, `app/(app)/[program]/layout.tsx` stops routing it here.
 */
export function ProgramGate() {
  const program = useProgram();
  const config = useProgramConfig();
  const { user, loading } = useAuth();
  const router = useRouter();
  const [membership, setMembership] = useState<Membership>("loading");

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    if (!user || !isFirebaseConfigured()) return;
    return onSnapshot(
      programDoc(db, program, "users", user.uid),
      (snap) => setMembership(membershipOfProfile(snap.exists(), snap.data())),
      // The rules deny a read when the account has no profile in this program: that is "no team yet", not a failure.
      (err) => setMembership((err as { code?: string }).code === "permission-denied" ? "none" : { error: failureDetails(reportFirestoreError("program membership", err, programPath(program, `users/${user.uid}`))) }),
    );
  }, [user, program]);

  return (
    <ProgramSetupFrame>
      {membership === "none" || membership === "left" ? (
        <TeamSetupScreen onComplete={() => router.replace("/dashboard")} />
      ) : (
      <div className="glass-card flex flex-col gap-2 p-6">
        <h1 className="text-xl font-semibold">{config.brand.fullName}</h1>
        {membership === "loading" && <p className="text-sm text-[var(--muted-foreground)]">Checking your {config.brand.label} team...</p>}
        {membership === "member" && (
          <p className="text-sm text-[var(--muted-foreground)]">
            Your {config.brand.label} team is set up. The {config.brand.label} pages are being connected to the shared app and will appear here.
          </p>
        )}
        {typeof membership === "object" && <p className="text-sm text-[var(--destructive,#d33)]">Could not read your {config.brand.label} membership: {membership.error}</p>}
      </div>
      )}
    </ProgramSetupFrame>
  );
}

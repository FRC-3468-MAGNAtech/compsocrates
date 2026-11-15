"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api-client";
import { useProgramConfig } from "@/lib/program/context";
import { useProgramData } from "@/lib/program/data";
import { TeamSetupCard } from "@/components/auth/team-setup-card";
import { Button } from "@/components/ui/button";

const isDenied = (err: unknown) => (err as { code?: string } | null)?.code === "permission-denied";

/**
 * Setup screen for a signed-in person with no profile in a program that has an enrollment port (ProgramData.enrollment). It is the same card every
 * program uses (`TeamSetupCard`: Join a team, then Create a team); this only says what happens on submit here: a join request through the port, or
 * a new team and the person's profile through the port. When the profile is written, the shell's own subscription picks it up and replaces this
 * screen, so nothing here navigates.
 */
export function TeamSetup() {
  const config = useProgramConfig();
  const data = useProgramData();
  const { user } = useAuth();
  const [sentTo, setSentTo] = useState<string | null>(null);

  if (!data || !user) return null;
  const { enrollment } = data;
  const label = config.brand.label;

  if (sentTo) {
    return (
      <div className="glass-card flex flex-col gap-3 p-5 sm:p-6" role="status">
        <h1 className="text-xl font-semibold">Request sent</h1>
        <p className="text-sm">Request sent for code {sentTo}. A team admin has to approve it. This page moves on by itself once they do.</p>
        <Button variant="glass" className="min-h-11 w-full" onClick={() => setSentTo(null)}>
          Send another request
        </Button>
      </div>
    );
  }

  return (
    <TeamSetupCard
      programLabel={label}
      creation="open"
      defaultName={user.displayName ?? (user.email ?? "").split("@")[0] ?? ""}
      onJoin={async ({ code, name }) => {
        try {
          await enrollment.requestToJoin(code, { uid: user.uid, name });
        } catch (err) {
          // The route says which: no such team, this account already has a team, too many tries, or the server is not set up.
          throw new Error(err instanceof ApiError ? err.message : "Could not send your request. Check your connection and try again.");
        }
        setSentTo(code);
      }}
      onCreate={async ({ teamNumber, teamName, role, name }) => {
        try {
          // A team needs a name: a blank one is "Team <number>". No location is asked for here.
          await enrollment.createTeam({ uid: user.uid, email: user.email ?? "", name, teamNumber, teamName: teamName || `Team ${teamNumber}`, location: "", role });
        } catch (err) {
          throw new Error(isDenied(err) ? "Your account already has a team here, or the team could not be created. Reload the page and try again." : "Could not create your team. Check your connection and try again.");
        }
        // Stay busy: the shell replaces this screen as soon as the new profile arrives.
      }}
      onApply={() => {}}
      footnote={`Accounts moved from the previous ${label} site appear here once the data import has run.`}
    />
  );
}

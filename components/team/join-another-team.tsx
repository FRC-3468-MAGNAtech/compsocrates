"use client";

import { useState } from "react";
import { TeamSetupCard } from "@/components/auth/team-setup-card";
import Link from "@/components/program/link";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { membershipApi } from "@/lib/memberships/client";
import { friendlyMembershipError, MEMBERSHIP_TEXT } from "@/lib/memberships/strings";
import { useProgram, useProgramConfig } from "@/lib/program/context";

/**
 * "Join another team": the join screen for a person who is already on a team here (memberships kill switch ON only; the shell shows it at `/<program>/apply-to-team`
 * for a person with a team). The same card every program uses, joining only: the request goes through the program-aware route, and a team that lets joiners pick a
 * role shows the role select after the code is checked. The person stays on their current team; they switch to the new one after an admin approves.
 */
export function JoinAnotherTeam() {
  const program = useProgram();
  const config = useProgramConfig();
  const { user } = useAuth();
  const [sentTo, setSentTo] = useState<string | null>(null);
  if (!user) return null;

  if (sentTo) {
    return (
      <div className="glass-card mx-auto flex max-w-xl flex-col gap-3 p-5 sm:p-6" role="status">
        <h1 className="text-xl font-semibold">Request sent</h1>
        <p className="text-sm">{MEMBERSHIP_TEXT.join.sent(sentTo)}</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="glass" className="min-h-11 flex-1" onClick={() => setSentTo(null)}>
            Send another request
          </Button>
          <Link href="/dashboard" className="flex min-h-11 flex-1 items-center justify-center rounded-xl border border-[var(--glass-border,var(--border))] px-4 text-sm font-medium">
            Back to the dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl">
      <TeamSetupCard
        programLabel={config.brand.label}
        heading={MEMBERSHIP_TEXT.join.anotherTitle}
        description={MEMBERSHIP_TEXT.join.anotherBody}
        creation="none"
        defaultName={user.displayName ?? (user.email ?? "").split("@")[0] ?? ""}
        joinLookup={(code) => membershipApi.joinLookup(program, code)}
        onJoin={async ({ code, name, role }) => {
          try {
            await membershipApi.requestJoin(program, { code, name, ...(role ? { requestedRole: role } : {}) });
          } catch (err) {
            throw new Error(friendlyMembershipError(err, "Could not send your request. Check your connection and try again."));
          }
          setSentTo(code);
        }}
        onCreate={async () => {}}
        onApply={() => {}}
      />
    </div>
  );
}

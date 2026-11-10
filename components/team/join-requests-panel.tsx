"use client";

import { useState } from "react";
import { Check, UserPlus, X } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/ui/glass-panel";
import { approveJoinRequest, denyJoinRequest, usePendingJoinRequests } from "@/lib/join-requests-client";
import { getRole } from "@/lib/roles";
import type { JoinRequest } from "@/data/cs/join-requests";

const fmt = (ms: number) => (ms > 0 ? new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "recently");

type Busy = { id: string; action: "approve" | "deny" } | null;

/**
 * CS's join-request queue in Team Management (docs/ROUTES.md D1/D6): people who typed the team's code and are waiting for an
 * admin. Approve sets their team and role (server-side, `/api/team/join-requests/approve`); Deny closes the request. Shown to team
 * admins only; the server and the rules check it again. Realtime, so a request someone else handles disappears here.
 */
export function JoinRequestsPanel({ teamId }: { teamId: string }) {
  const { requests, loaded } = usePendingJoinRequests(teamId);
  const [busy, setBusy] = useState<Busy>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const act = async (request: JoinRequest, action: "approve" | "deny") => {
    setBusy({ id: request.id, action });
    setMessage(null);
    try {
      if (action === "approve") {
        const res = await approveJoinRequest(request.id);
        setMessage({ kind: "ok", text: `${res.userName || request.userName} has been added to the team.` });
      } else {
        await denyJoinRequest(request.id);
        setMessage({ kind: "ok", text: `Denied ${request.userName}'s request.` });
      }
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Something went wrong. Try again." });
    } finally {
      setBusy(null);
    }
  };

  return (
    <GlassPanel className="flex flex-col gap-3" data-testid="join-requests-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
          <UserPlus className="h-4 w-4" /> Join requests {loaded && requests.length > 0 && `(${requests.length})`}
        </h2>
      </div>

      {message && (
        <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "text-sm text-red-300" : "text-sm text-emerald-300"}>
          {message.text}
        </p>
      )}

      {!loaded ? (
        <div className="glass-card h-16 animate-pulse" />
      ) : requests.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">No one is waiting to join. People who sign up with your team code will show up here for approval.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {requests.map((r) => {
            const role = getRole(r.requestedRole);
            const rowBusy = busy?.id === r.id;
            return (
              <li key={r.id} className="glass-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={r.userName} size="md" />
                  <div className="min-w-0">
                    <div className="truncate font-medium">{r.userName}</div>
                    <div className="truncate text-xs text-[var(--muted-foreground)]">{r.userEmail || "No email on file"}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--muted-foreground)]">
                      <Badge className={role.className}>{role.label}</Badge>
                      <span>Asked {fmt(r.createdAtMs)}</span>
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button className="min-h-11 gap-2" disabled={busy !== null} onClick={() => void act(r, "approve")} aria-label={`Approve ${r.userName}`}>
                    <Check className="h-4 w-4" /> {rowBusy && busy?.action === "approve" ? "Approving…" : "Approve"}
                  </Button>
                  <Button variant="glass" className="min-h-11 gap-2" disabled={busy !== null} onClick={() => void act(r, "deny")} aria-label={`Deny ${r.userName}`}>
                    <X className="h-4 w-4" /> {rowBusy && busy?.action === "deny" ? "Denying…" : "Deny"}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </GlassPanel>
  );
}

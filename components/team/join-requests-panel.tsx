"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, UserPlus, X } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/ui/glass-panel";
import { ConfirmDialog } from "@/components/scout/confirm-dialog";
import { LoadError } from "@/components/practice/load-error";
import { useAuth } from "@/lib/auth";
import type { FirestoreFailure } from "@/lib/firestore-errors";
import { approveJoinRequest, denyJoinRequest, usePendingJoinRequests } from "@/lib/join-requests-client";
import { useProgramData } from "@/lib/program/data";
import { DEFAULT_ROLE_ID, getRole, ROLES, type RoleId } from "@/lib/roles";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { isRequestableRole } from "@/lib/memberships/flows";
import { membershipApi, useMembershipsEnabled } from "@/lib/memberships/client";
import { friendlyMembershipError, MEMBERSHIP_TEXT } from "@/lib/memberships/strings";
import { useProgram } from "@/lib/program/context";

const fmt = (ms: number | null) => (ms && ms > 0 ? new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "recently");

/** One waiting request, whichever program it came from. */
type Row = { id: string; name: string; email: string; roleId: string | null; requestedAtMs: number | null };

type Action = "approve" | "deny";
type Busy = { id: string; action: Action } | null;
type Pending = { row: Row; action: Action } | null;

/**
 * The team's waiting join requests: the root program's through its server routes (`usePendingJoinRequests`), a program with a data port through that
 * port (`ProgramData.joinRequests`, realtime, a batch under the program's own paths). Same rows, same panel.
 */
function usePendingRows(teamId: string): { rows: Row[]; loaded: boolean; failure: FirestoreFailure | null } {
  const port = useProgramData();
  const root = usePendingJoinRequests(port ? null : teamId);
  const [ported, setPorted] = useState<{ teamId: string; rows: Row[]; failure: FirestoreFailure | null } | null>(null);

  useEffect(() => {
    if (!port) return;
    return port.joinRequests.subscribePending(
      teamId,
      (requests) => setPorted({ teamId, rows: requests.map((r) => ({ id: r.uid, name: r.name, email: "", roleId: r.requestedRole ?? null, requestedAtMs: r.requestedAtMs })), failure: null }),
      (failure) => setPorted({ teamId, rows: [], failure }) // already reported by the port
    );
  }, [port, teamId]);

  const rootRows = useMemo<Row[]>(() => root.requests.map((r) => ({ id: r.id, name: r.userName, email: r.userEmail, roleId: r.requestedRole, requestedAtMs: r.createdAtMs })), [root.requests]);
  if (!port) return { rows: rootRows, loaded: root.loaded, failure: null };
  const mine = ported?.teamId === teamId ? ported : null;
  return { rows: mine?.rows ?? [], loaded: mine !== null, failure: mine?.failure ?? null };
}

/**
 * CS's join-request queue in Team Management (docs/ROUTES.md D1/D6): people who typed the team's code and are waiting for an
 * admin. Approve adds them to the team (the root program through `/api/team/join-requests/approve`, a program with a port through its own batch);
 * Deny closes the request. Both ask first. Shown to team admins only; the server and the rules check it again. Realtime, so a request someone
 * else handles disappears here.
 */
export function JoinRequestsPanel({ teamId, allowRoleChoice = false }: { teamId: string; /** The team's "let joiners choose their role" switch: when ON (and memberships are ON) the card shows the role asked for and lets the admin change it. */ allowRoleChoice?: boolean }) {
  const port = useProgramData();
  const program = useProgram();
  const memberships = useMembershipsEnabled();
  const { user } = useAuth();
  const [chosen, setChosen] = useState<Record<string, RoleId>>({});
  const { rows, loaded, failure } = usePendingRows(teamId);
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  // The role the admin will approve with (only used while memberships are ON and the team lets joiners choose): the one picked here, else the one asked for, else Match Scout.
  const roleFor = (row: Row): RoleId => chosen[row.id] ?? (row.roleId && isRequestableRole(row.roleId) ? (row.roleId as RoleId) : DEFAULT_ROLE_ID);

  const act = async (row: Row, action: Action) => {
    setBusy({ id: row.id, action });
    setMessage(null);
    try {
      if (memberships) {
        // Memberships ON: one program-aware server route decides (it also checks the role: only a valid non-admin role, and only when the team lets joiners choose).
        const res = await membershipApi.decide(program, { teamId, requestId: row.id, action, ...(action === "approve" && allowRoleChoice ? { role: roleFor(row) } : {}) });
        setMessage({ kind: "ok", text: action === "approve" ? `${res.userName || row.name} has been added to the team.` : `Denied ${row.name}'s request.` });
      } else if (port) {
        if (!user) throw new Error("Sign in again to decide this request.");
        if (action === "approve") await port.joinRequests.approve(teamId, { uid: row.id, name: row.name }, user.uid);
        else await port.joinRequests.deny(teamId, row.id, user.uid);
        setMessage({ kind: "ok", text: action === "approve" ? `${row.name} has been added to the team.` : `Denied ${row.name}'s request.` });
      } else if (action === "approve") {
        const res = await approveJoinRequest(row.id);
        setMessage({ kind: "ok", text: `${res.userName || row.name} has been added to the team.` });
      } else {
        await denyJoinRequest(row.id);
        setMessage({ kind: "ok", text: `Denied ${row.name}'s request.` });
      }
    } catch (err) {
      // One message for every program: the reason when there is one, else the usual causes.
      const reason = memberships ? ` ${friendlyMembershipError(err, "It may have been handled already, or you may not be allowed to.")}` : err instanceof Error && err.message ? ` ${err.message}` : " It may have been handled already, or you may not be allowed to.";
      setMessage({ kind: "error", text: `Couldn't ${action === "approve" ? "approve" : "deny"} ${row.name}'s request.${reason}` });
    } finally {
      setBusy(null);
    }
  };

  return (
    <GlassPanel className="flex flex-col gap-3" data-testid="join-requests-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
          <UserPlus className="h-4 w-4" /> Join requests {loaded && rows.length > 0 && `(${rows.length})`}
        </h2>
      </div>

      {message && (
        <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "text-sm text-red-300" : "text-sm text-emerald-300"}>
          {message.text}
        </p>
      )}

      {failure ? (
        <LoadError failure={failure} />
      ) : !loaded ? (
        <div className="glass-card h-16 animate-pulse" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">No one is waiting to join. People who ask to join with your team code will show up here for approval.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => {
            const role = r.roleId ? getRole(r.roleId) : null;
            const rowBusy = busy?.id === r.id;
            return (
              <li key={r.id} className="glass-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={r.name} size="md" />
                  <div className="min-w-0">
                    <div className="truncate font-medium">{r.name}</div>
                    {(r.email || !port) && <div className="truncate text-xs text-[var(--muted-foreground)]">{r.email || "No email on file"}</div>}
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--muted-foreground)]">
                      {role && <Badge className={role.className}>{memberships && allowRoleChoice ? `${MEMBERSHIP_TEXT.members.requestedRole}: ${role.label}` : role.label}</Badge>}
                      <span>Asked {fmt(r.requestedAtMs)}</span>
                    </div>
                    {memberships && allowRoleChoice && (
                      <div className="mt-2 max-w-[16rem]">
                        <Select value={roleFor(r)} onValueChange={(v) => setChosen((c) => ({ ...c, [r.id]: v as RoleId }))} disabled={busy !== null}>
                          <SelectTrigger aria-label={`Role for ${r.name}`} className="min-h-11">
                            <SelectValue>{getRole(roleFor(r)).label}</SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {ROLES.filter((x) => isRequestableRole(x.id)).map((x) => (
                              <SelectItem key={x.id} value={x.id} className="py-2.5">
                                {x.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button className="min-h-11 gap-2" disabled={busy !== null} onClick={() => setPending({ row: r, action: "approve" })} aria-label={`Approve ${r.name}`}>
                    <Check className="h-4 w-4" /> {rowBusy && busy?.action === "approve" ? "Approving…" : "Approve"}
                  </Button>
                  <Button variant="glass" className="min-h-11 gap-2" disabled={busy !== null} onClick={() => setPending({ row: r, action: "deny" })} aria-label={`Deny ${r.name}`}>
                    <X className="h-4 w-4" /> {rowBusy && busy?.action === "deny" ? "Denying…" : "Deny"}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title={pending?.action === "deny" ? `Deny ${pending.row.name}?` : `Approve ${pending?.row.name ?? ""}?`}
        description={
          pending?.action === "deny"
            ? "They will not join the team. They can send a new request later."
            : memberships && allowRoleChoice && pending
              ? `They join your team as ${getRole(roleFor(pending.row)).label}. You can change their role afterwards in the member list.`
              : "They join your team as a regular member. You can change their role afterwards in the member list."
        }
        confirmLabel={pending?.action === "deny" ? "Deny request" : "Approve request"}
        cancelLabel="Cancel"
        onConfirm={() => {
          if (pending) void act(pending.row, pending.action);
        }}
        testId="join-request-confirm"
      />
    </GlassPanel>
  );
}

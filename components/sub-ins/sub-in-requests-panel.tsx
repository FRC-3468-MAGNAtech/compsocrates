"use client";

import Link from "@/components/program/link";
import { ClipboardCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { canCancel, type SubInRequest } from "@/lib/sub-ins/model";

const timeOf = (ms: number): string => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/**
 * CS "Sub-In Requests" list (TeamRoleDashboard), presentational: each row is one request with Take Sub-In (anyone but the requester), Delete Request (the requester,
 * while it is open) or "Sub Assigned - name" once taken. The scout who took one gets a Scout now link. `requests` is already the visible list (`visibleRequests`).
 */
export function SubInRequestsPanel({
  requests,
  uid,
  now,
  busyId,
  scoutHref,
  onClaim,
  onCancel,
}: {
  requests: readonly SubInRequest[];
  uid: string | null;
  now: number;
  busyId: string | null;
  /** Where "Scout now" goes for a sub-in I took (the Match Scout Form with my next assignment loaded). */
  scoutHref: string | null;
  onClaim: (request: SubInRequest) => void;
  onCancel: (request: SubInRequest) => void;
}) {
  return (
    <ul className="flex flex-col gap-2" data-testid="sub-in-list">
      {requests.map((r) => {
        const mine = !!uid && r.requestedById === uid;
        const coveredByMe = !!uid && r.status === "claimed" && r.claimedById === uid;
        return (
          <li key={r.id} data-testid={`sub-in-${r.id}`} className="flex flex-col gap-2 rounded-xl border border-[var(--glass-border)] px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 text-sm">
              <div>
                <span className="font-semibold">{r.matchLabel || r.matchKey}</span>
                <span className="text-[var(--muted-foreground)]"> · Team {r.teamNumber}</span>
              </div>
              <div className="truncate text-xs text-[var(--muted-foreground)]">
                {r.requestedByName ? `Requested by ${mine ? "you" : r.requestedByName}` : "Requested"} · {timeOf(r.requestedAt)}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {r.status === "claimed" ? (
                <>
                  <Badge variant="success">Sub Assigned{r.claimedByName ? ` · ${coveredByMe ? "you" : r.claimedByName}` : ""}</Badge>
                  {coveredByMe && scoutHref && (
                    <Link href={scoutHref}>
                      <Button size="sm" className="min-h-11 gap-1.5">
                        <ClipboardCheck className="h-4 w-4" aria-hidden /> Scout now
                      </Button>
                    </Link>
                  )}
                </>
              ) : canCancel(r, uid ?? "", now) ? (
                <Button size="sm" variant="glass" className="min-h-11" disabled={busyId === r.id} onClick={() => onCancel(r)}>
                  {busyId === r.id ? "Deleting…" : "Delete request"}
                </Button>
              ) : (
                <Button size="sm" className="min-h-11" disabled={!uid || busyId === r.id} onClick={() => onClaim(r)}>
                  {busyId === r.id ? "Assigning…" : "Take sub-in"}
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db, isFirebaseConfigured } from "@/lib/firebase/client";
import { readJoinRequest, type CsJoinRequestDoc, type JoinRequest } from "@/data/cs/join-requests";
import { authedApi } from "@/lib/api-client";

type Listing = { requests: JoinRequest[]; loaded: boolean };

function useRequests(key: string | null, field: "userId" | "teamId", pendingOnly: boolean): Listing {
  const [state, setState] = useState<Listing>({ requests: [], loaded: false });

  useEffect(() => {
    if (!key || !isFirebaseConfigured()) {
      // Deliberate: clears the list when there is nothing to subscribe to (signed out, or no team yet).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState({ requests: [], loaded: true });
      return;
    }
    // A requester may read their own rows (`userId == uid`); a team admin reads their team's (`teamId == code`). Both are
    // single-field/equality queries, so no composite index is needed (CS rules: `teamJoinRequests` read).
    const q = pendingOnly
      ? query(collection(db, "teamJoinRequests"), where(field, "==", key), where("status", "==", "pending"))
      : query(collection(db, "teamJoinRequests"), where(field, "==", key));
    return onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => readJoinRequest(d.id, d.data() as CsJoinRequestDoc)).sort((a, b) => b.createdAtMs - a.createdAtMs);
        setState({ requests: rows, loaded: true });
      },
      (err) => {
        console.error("teamJoinRequests subscription failed:", err);
        setState({ requests: [], loaded: true });
      }
    );
  }, [key, field, pendingOnly]);

  return state;
}

/** The signed-in user's own join requests (any status), newest first: drives the "pending" screen. */
export function useMyJoinRequests(uid: string | null): Listing {
  return useRequests(uid, "userId", false);
}

/** A team's PENDING join requests, newest first: the Team Management queue (team admins only; the rules decide). */
export function usePendingJoinRequests(teamId: string | null): Listing {
  return useRequests(teamId, "teamId", true);
}

export const approveJoinRequest = (requestId: string) => authedApi<{ userName?: string }>("/api/team/join-requests/approve", { method: "POST", body: { requestId } });
export const denyJoinRequest = (requestId: string) => authedApi("/api/team/join-requests/deny", { method: "POST", body: { requestId } });
export const cancelJoinRequest = (requestId: string) => authedApi("/api/team/join-requests/cancel", { method: "POST", body: { requestId } });

/** The team's display label for a code (CS `/api/team-label`, over the Admin SDK), or null when it can't be resolved. */
export async function fetchTeamLabel(teamCode: string): Promise<{ exists: boolean; label: string } | null> {
  try {
    const res = await authedApi<{ exists: boolean; label: string }>(`/api/team/label?teamCode=${encodeURIComponent(teamCode)}`);
    return { exists: res.exists === true, label: String(res.label ?? "") };
  } catch {
    return null;
  }
}

/** Deletes the caller's join requests and user doc server-side (CS `/api/user/delete`); the caller then deletes their sign-in account. */
export const deleteMyAccountData = () => authedApi("/api/user/delete", { method: "POST", body: {} });

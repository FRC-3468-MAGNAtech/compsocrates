"use client";

import { useEffect, useState } from "react";
import { authedApi } from "@/lib/api-client";
import type { ProgramId } from "@/lib/memberships/model";

/**
 * The browser side of the membership features: the kill switch (learned once per page load from the public config route, never from Firestore: `appSettings` is
 * closed to clients) and one function per server route. Every route takes the program in the body.
 */
let enabledPromise: Promise<boolean> | null = null;
/** The answer once it has arrived, so a component that mounts later starts with it instead of flashing "off" for one render. */
let knownEnabled = false;

/** Is the kill switch ON? Asked once per page load; a failure or a missing answer is OFF. */
export function membershipsEnabled(): Promise<boolean> {
  if (!enabledPromise) {
    enabledPromise = fetch("/api/public/config")
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { membershipsEnabled?: unknown } | null) => json?.membershipsEnabled === true)
      .catch(() => false)
      .then((value) => {
        knownEnabled = value;
        return value;
      });
  }
  return enabledPromise;
}

/** Test hook: forget the answer, or set it. */
export function resetMembershipsEnabled(value?: boolean): void {
  enabledPromise = value === undefined ? null : Promise.resolve(value);
  knownEnabled = value === true;
}

/** The kill switch as a hook: false until the answer arrives, so nothing membership-related shows or reads while it is OFF or unknown. */
export function useMembershipsEnabled(): boolean {
  const [on, setOn] = useState(() => knownEnabled);
  useEffect(() => {
    let alive = true;
    void membershipsEnabled().then((v) => {
      if (alive) setOn(v);
    });
    return () => {
      alive = false;
    };
  }, []);
  return on;
}

const post = <T>(path: string, body: Record<string, unknown>) => authedApi<T>(path, { method: "POST", body, timeoutMs: 25_000 });

export type JoinLookup = { exists: boolean; allowsRoleChoice: boolean; alreadyMember: boolean; atLimit: boolean };
export type AdminToVerifyRow = { uid: string; name: string; role: string | null; isAdmin: boolean; isOwner: boolean; membership: "pointer" | "verified" | "none"; evidence: string };

export const membershipApi = {
  joinLookup: (program: ProgramId, code: string) => post<JoinLookup>("/api/team/join-lookup", { program, code }),
  requestJoin: (program: ProgramId, input: { code: string; name: string; requestedRole?: string }) => post<{ teamId: string; requestId: string; alreadyPending: boolean }>("/api/team/membership/request-join", { program, ...input }),
  decide: (program: ProgramId, input: { teamId: string; requestId: string; action: "approve" | "deny"; role?: string }) => post<{ userName?: string; role?: string }>("/api/team/membership/decide", { program, ...input }),
  switchTeam: (program: ProgramId, teamId: string) => post<{ ok: true }>("/api/team/switch", { program, teamId }),
  leave: (program: ProgramId, teamId: string) => post<{ activeTeamId: string | null }>("/api/team/leave", { program, teamId }),
  remove: (program: ProgramId, input: { teamId: string; uid: string }) => post("/api/team/member/remove", { program, ...input }),
  access: (program: ProgramId, input: { teamId: string; uid: string; changes: { primaryRole?: string; secondaryRoles?: string[]; isAdmin?: boolean } }) => post("/api/team/member/access", { program, ...input }),
  listAdmins: (program: ProgramId, teamId: string) => post<{ confirmName: string; admins: AdminToVerifyRow[] }>("/api/platform/verify-admins", { action: "list", program, teamId }),
  verifyAdmins: (program: ProgramId, input: { teamId: string; uids: string[]; confirmName: string }) =>
    post<{ verified: string[]; alreadyVerified: string[]; skipped: { uid: string; reason: string }[] }>("/api/platform/verify-admins", { action: "verify", program, ...input }),
};

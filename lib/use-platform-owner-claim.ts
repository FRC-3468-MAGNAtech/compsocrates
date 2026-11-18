"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";

/**
 * Is the signed-in account a PLATFORM owner, by the `platformOwner` custom claim on its ID token (set only by the server's sign-in sync, never by a client)? A program's
 * profile mirrors the flag (`profile.isPlatformOwner`), but an owner with no team in a program has no profile there, so the claim is the other way to know. This is a
 * display and routing hint only: every owner action is re-checked on the server and by the rules, which read the same claim. One token read per sign-in, no Firestore.
 */
export function usePlatformOwnerClaim(): boolean {
  return usePlatformOwnerClaimState().claim;
}

/** The claim and whether it has been read yet (the shell waits for it before it routes an account that has no team). */
export function usePlatformOwnerClaimState(): { claim: boolean; ready: boolean } {
  const { user } = useAuth();
  const [held, setHeld] = useState<{ uid: string; claim: boolean } | null>(null);
  const uid = user?.uid ?? null;
  useEffect(() => {
    if (!user) return;
    let alive = true;
    user
      .getIdTokenResult()
      .then((result) => alive && setHeld({ uid: user.uid, claim: result.claims.platformOwner === true }))
      .catch(() => alive && setHeld({ uid: user.uid, claim: false }));
    return () => {
      alive = false;
    };
  }, [user]);
  const ready = uid === null || held?.uid === uid;
  return { claim: uid !== null && held?.uid === uid && held.claim, ready };
}

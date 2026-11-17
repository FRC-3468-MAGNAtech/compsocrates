"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AuthContext, useAuth, type AuthContextValue, type UserDoc } from "@/lib/auth";
import { useProgramData } from "@/lib/program/data";

const NOT_SIGNED_IN = "Not signed in.";

/**
 * The signed-in person's profile for the active program. The sign-in itself (the Firebase user, sign out, password) is one account across programs and
 * is passed through; the profile document (team, roles, admin, theme, avatar) is the program's own. For a program with a data port that is read from its
 * own user doc, so `useAuth().profile` anywhere under it is that program's profile. The root program has no port: this renders its children untouched
 * and its profile is read by `AuthProvider` exactly as before.
 *
 * Writes to the profile (`updateUserProfile`: name, theme, avatar) go to that program's own user doc through its port, never to the root program's.
 */
export function ProgramAuth({ children }: { children: ReactNode }) {
  const data = useProgramData();
  const base = useAuth();
  const uid = base.user?.uid ?? null;
  const [held, setHeld] = useState<{ uid: string; profile: UserDoc | null } | null>(null);

  useEffect(() => {
    if (!data || !uid) return;
    return data.profile.subscribe(
      uid,
      (profile) => setHeld({ uid, profile }),
      () => setHeld({ uid, profile: null }) // already reported by the port
    );
  }, [data, uid]);

  const value = useMemo<AuthContextValue | null>(() => {
    if (!data) return null;
    const loaded = uid === null || held?.uid === uid;
    return {
      ...base,
      profile: uid !== null && held?.uid === uid ? held.profile : null,
      loading: base.loading || !loaded,
      updateUserProfile: (patch) => (uid ? data.profile.update(uid, patch) : Promise.reject(new Error(NOT_SIGNED_IN))),
    };
  }, [data, base, uid, held]);

  if (!value) return <>{children}</>;
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

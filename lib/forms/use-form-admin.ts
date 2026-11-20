"use client";

import { useMemo } from "react";
import { personName } from "@/lib/people/display-name";
import { useAuth } from "@/lib/auth";
import { useProgram } from "@/lib/program/context";
import { createFirestoreFormStore } from "@/lib/forms/firestore-store";
import type { FormActor } from "@/lib/forms/actions";
import type { FormStore } from "@/lib/forms/store";
import { usageByForm, type FormUsage } from "@/lib/forms/usage";
import { useTeamMembers } from "@/lib/team-members";
import { useTeamScoutEntries } from "@/lib/scout-entries";

/**
 * Everything the Forms admin tab needs from the account: the Firestore form store bound to this admin, who they are for the audit log,
 * how many entries each form has (an unversioned-aware count), and a uid -> name map for "last edited by".
 */
export function useFormAdmin(): {
  teamId: string | null;
  actor: FormActor | null;
  store: FormStore | null;
  usage: ReadonlyMap<string, FormUsage>;
  entriesLoaded: boolean;
  nameOf: (uid: string | undefined) => string;
} {
  const { user, profile } = useAuth();
  const program = useProgram();
  const teamId = profile?.teamId ?? null;
  const uid = user?.uid ?? null;
  const name = profile?.name ?? "";
  const { entries, loaded: entriesLoaded } = useTeamScoutEntries(teamId);
  const { members } = useTeamMembers(teamId, { live: true });
  const usage = useMemo(() => usageByForm(entries), [entries]);
  const store = useMemo(() => (teamId && uid ? createFirestoreFormStore(teamId, { uid }, program) : null), [teamId, uid, program]);
  const actor = useMemo<FormActor | null>(() => (teamId && uid ? { teamId, uid, name, program } : null), [teamId, uid, name, program]);
  const nameOf = useMemo(() => (id: string | undefined) => (id ? personName(id, members, "a former member") : "—"), [members]);
  return { teamId, actor, store, usage, entriesLoaded, nameOf };
}

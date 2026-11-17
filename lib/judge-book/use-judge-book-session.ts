"use client";

import { useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { canEditJudgeBook } from "@/lib/judge-book/model";
import { useJudgeBook } from "@/lib/judge-book/store";

/** The signed-in member's view of the Judge Book: the live cards plus whether they may edit (CS rules, see `canEditJudgeBook`). */
export function useJudgeBookSession() {
  const { user, profile } = useAuth();
  const teamId = profile?.teamId || null;
  const uid = user?.uid ?? null;
  const name = profile?.name ?? "";
  const actor = useMemo(() => (uid ? { uid, name } : null), [uid, name]);
  const book = useJudgeBook(teamId, actor);
  const canEdit = canEditJudgeBook(
    profile ? { uid, isAdmin: profile.isAdmin, primaryRole: profile.primaryRole, secondaryRoles: profile.secondaryRoles } : null,
    book.grants
  );
  return { ...book, canEdit, hasTeam: Boolean(teamId) };
}

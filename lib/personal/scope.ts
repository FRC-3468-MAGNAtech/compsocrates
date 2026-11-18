// Is the practice code running for an account with NO team (the personal shell)? The shell sets this during render (`PersonalModeContext` provider in
// `app/(app)/[program]/layout.tsx`, a parent, so it is set before any child effect runs) and clears it when the person has a team. The practice and entry writers consult it
// FIRST: with a scope they read and write the person's private path (`personalPractice/{uid}/...`, lib/personal/practice-store.ts) and never a team collection.
// Plain module state on purpose: those writers are plain functions with many callers, and the personal shell renders no team page.

let scopeUid: string | null = null;

export function setPersonalScope(uid: string | null): void {
  scopeUid = uid;
}

/** The uid whose private practice the code is working in, or null (the normal, team case). */
export function personalScopeUid(): string | null {
  return scopeUid;
}

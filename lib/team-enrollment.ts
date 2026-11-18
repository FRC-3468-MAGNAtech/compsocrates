"use client";

import { auth } from "@/lib/firebase/client";

async function authedPost(path: string, body: unknown): Promise<Record<string, unknown>> {
  if (!auth.currentUser) throw new Error("Not signed in.");
  const idToken = await auth.currentUser.getIdToken();
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) {
    throw new Error(typeof json.error === "string" ? json.error : "Something went wrong.");
  }
  return json;
}

/** Whether applications are open (the platform owner's "Accept team applications", `appSettings/global.teamCreationEnabled`) — a public, unauthenticated read (see app/api/public/config/route.ts), never a direct Firestore read. */
export async function fetchTeamCreationEnabled(): Promise<boolean> {
  try {
    const res = await fetch("/api/public/config");
    const json = await res.json();
    return Boolean(json.teamCreationEnabled);
  } catch {
    return false;
  }
}

/** Owner-only — see app/api/admin/team-creation/route.ts. Throws on failure (including "not an owner") so the caller can show it. */
export async function setTeamCreationEnabled(enabled: boolean): Promise<void> {
  await authedPost("/api/admin/team-creation", { enabled });
}

/**
 * Whether team admins see every profile of their own team (owner switch, default on). Public read of the same config route; a failed
 * read answers null ("unknown"), which callers treat as on, because the profile rules are the real gate.
 */
export async function fetchAdminsSeeAllProfiles(): Promise<boolean | null> {
  try {
    const res = await fetch("/api/public/config");
    const json = await res.json();
    return typeof json.adminsSeeAllProfiles === "boolean" ? json.adminsSeeAllProfiles : null;
  } catch {
    return null;
  }
}

/** Owner-only — see app/api/admin/admins-see-profiles/route.ts. Throws on failure so the caller can show it. */
export async function setAdminsSeeAllProfiles(enabled: boolean): Promise<void> {
  await authedPost("/api/admin/admins-see-profiles", { enabled });
}

/** Called right after every sign-in — see app/api/auth/sync-roles/route.ts and lib/auth.tsx. */
export async function syncRoles(): Promise<{ changed: boolean; ownerPendingVerification: boolean }> {
  if (!auth.currentUser) return { changed: false, ownerPendingVerification: false };
  try {
    const result = await authedPost("/api/auth/sync-roles", {});
    return { changed: Boolean(result.changed), ownerPendingVerification: Boolean(result.ownerPendingVerification) };
  } catch {
    return { changed: false, ownerPendingVerification: false };
  }
}

"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { readStoredProgram } from "@/lib/program/context";

/** The query that keeps a signed-in person on the home page so they can pick a program (`/?choose=1`). */
export const CHOOSE_PROGRAM_HREF = "/?choose=1";

/**
 * Home page only: a signed-in person with a remembered program goes straight to that program's dashboard. With no history
 * (nothing in localStorage or the `program` cookie) the selector stays, rather than guessing. `?choose=1` also keeps it.
 * Renders nothing.
 */
export function HomeRedirect() {
  const { user, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (loading || !user) return;
    if (new URLSearchParams(window.location.search).has("choose")) return;
    const last = readStoredProgram();
    if (last) router.replace(`/${last}/dashboard`);
  }, [loading, user, router]);
  return null;
}

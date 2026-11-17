"use client";

import { useMemo } from "react";
import { useParams, usePathname as useNextPathname, useRouter as useNextRouter, useSearchParams } from "next/navigation";
import { useProgram } from "@/lib/program/context";
import { programHref, splitProgramPath } from "@/lib/program/paths";

// Program-aware drop-ins for next/navigation. Pages keep writing program-relative paths ("/scout"); `push` and
// `replace` add the active program, and `usePathname` returns the path without it, so active-link checks are unchanged.

export { useParams, useSearchParams };

export function useRouter() {
  const router = useNextRouter();
  const program = useProgram();
  return useMemo(
    () => ({
      ...router,
      push: (href: string, options?: Parameters<typeof router.push>[1]) => router.push(programHref(program, href), options),
      replace: (href: string, options?: Parameters<typeof router.replace>[1]) => router.replace(programHref(program, href), options),
      prefetch: (href: string, options?: Parameters<typeof router.prefetch>[1]) => router.prefetch(programHref(program, href), options),
    }),
    [router, program],
  );
}

/** The current path without its program segment ("/<program>/scout" -> "/scout"). */
export function usePathname(): string {
  const path = useNextPathname() ?? "/";
  return splitProgramPath(path).rest;
}

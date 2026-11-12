"use client";

import NextLink from "next/link";
import { forwardRef, type ComponentProps } from "react";
import { useProgram } from "@/lib/program/context";
import { programHref } from "@/lib/program/paths";

/**
 * `next/link` that understands programs: an app path like "/scout" becomes "/<program>/scout" for the active program.
 * Platform paths ("/login"), external URLs and paths that already carry a program are left alone (lib/program/paths.ts).
 */
const Link = forwardRef<HTMLAnchorElement, ComponentProps<typeof NextLink>>(function ProgramLink({ href, ...rest }, ref) {
  const program = useProgram();
  const resolved =
    typeof href === "string"
      ? programHref(program, href)
      : href.pathname
        ? { ...href, pathname: programHref(program, href.pathname) }
        : href;
  return <NextLink ref={ref} href={resolved} {...rest} />;
});

export default Link;

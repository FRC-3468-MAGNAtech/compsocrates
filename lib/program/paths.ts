// Program-scoped route helpers. Pure (no React): the Link/router wrappers, the proxy and the tests share them.

import { DEFAULT_PROGRAM, isProgramId, type ProgramId } from "@/config/programs/types";

/** Top-level paths that belong to the platform, not to a program: never prefixed. */
export const PLATFORM_PATHS = ["/", "/login", "/signup", "/apply", "/finish-setup", "/privacy-policy", "/terms-of-service", "/api"] as const;

export function isPlatformPath(path: string): boolean {
  const p = path.split(/[?#]/)[0] || "/";
  return PLATFORM_PATHS.some((x) => (x === "/" ? p === "/" : p === x || p.startsWith(`${x}/`)));
}

/** "/<program>/scout?x=1" -> { program, rest: "/scout?x=1" }; a path with no program segment -> program null. */
export function splitProgramPath(path: string): { program: ProgramId | null; rest: string } {
  const m = /^\/([^/?#]+)(.*)$/.exec(path);
  if (m && isProgramId(m[1])) return { program: m[1], rest: m[2] ? (/^[/?#]/.test(m[2]) ? (m[2].startsWith("/") ? m[2] : `/${m[2]}`) : m[2]) : "/" };
  return { program: null, rest: path };
}

/**
 * The one place a program-relative app path ("/scout") becomes a URL ("/<program>/scout"). Platform paths, external URLs,
 * hash/query-only hrefs and paths that already carry a program are returned unchanged.
 */
export function programHref(program: ProgramId, href: string): string {
  if (!href.startsWith("/") || href.startsWith("//")) return href;
  if (isPlatformPath(href) || splitProgramPath(href).program) return href;
  return `/${program}${href === "/" ? "" : href}`;
}

/**
 * A cache key scoped to a program. The default program's keys are returned unchanged (so everything cached for it before keeps its key and
 * its sharing between pages); another program's get its id in front, so two programs can never read each other's cached results.
 */
export function scopedKey(program: ProgramId, key: string): string {
  return program === DEFAULT_PROGRAM ? key : `${program}:${key}`;
}

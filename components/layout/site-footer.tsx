"use client";

import Link from "next/link";
import { useOurTeam } from "@/lib/our-team";
import { teamLabel } from "@/lib/team-number";
import { cn } from "@/lib/utils";
import { BRAND } from "@/config/brand";

/**
 * The small footer on every page (P14): a credit line plus the Credits and Changelog links. The credit line is
 * data-driven: signed in, it names the team ("Team 3468"); signed out (marketing pages, which can't read team data) it is just
 * the app name.
 */
export function SiteFooter({ className }: { className?: string }) {
  const { number } = useOurTeam();
  const teams = number !== null ? teamLabel(number) : "";
  return (
    <footer className={cn("flex flex-col items-center gap-3 py-6 text-sm text-[var(--muted-foreground)] sm:flex-row sm:justify-between", className)}>
      <span>
        &copy; {new Date().getFullYear()} {BRAND.copyrightHolder}{teams && <> &mdash; {teams}</>}
      </span>
      <nav aria-label="Footer" className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
        <Link href="/credits" className="transition-colors hover:text-[var(--foreground)]">
          Credits
        </Link>
        <Link href="/changelog" className="transition-colors hover:text-[var(--foreground)]">
          Changelog
        </Link>
        <Link href="/privacy-policy" className="transition-colors hover:text-[var(--foreground)]">
          Privacy Policy
        </Link>
        <Link href="/terms-of-service" className="transition-colors hover:text-[var(--foreground)]">
          Terms of Service
        </Link>
      </nav>
    </footer>
  );
}

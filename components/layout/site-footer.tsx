"use client";

import { PLATFORM } from "@/config/platform";
import { cn } from "@/lib/utils";

/**
 * The one site footer: the app shell, the landing page and every marketing and auth page render this component (the marketing layout covers
 * login, signup and the legal pages). "(c) {year} {holder}" then the teams; the holder links to the team site in a new tab. The text, the team
 * list and the URL come from `config/platform.ts`. It is plain content at the end of the page, never fixed or sticky, so it can never cover the
 * scout form's score bar or a Next / Cancel bar; the inner padding keeps it clear of the home indicator on phones.
 *
 * The year is read on the client, and the server-rendered page may have been built in an earlier year, so the year text is the one piece React is
 * told may differ between the server and the first client render (`suppressHydrationWarning`), instead of a hydration error.
 */
export function SiteFooter({ className }: { className?: string }) {
  const { holder, holderHref, teams } = PLATFORM.footer;
  return (
    <footer className={cn("px-4 py-6 text-center text-sm text-[var(--muted-foreground)]", className)} data-testid="site-footer">
      <div className="flex flex-col items-center gap-x-2 gap-y-1 pb-[env(safe-area-inset-bottom)] sm:flex-row sm:flex-wrap sm:justify-center">
        <span>
          &copy; <span suppressHydrationWarning>{new Date().getFullYear()}</span>{" "}
          <a href={holderHref} target="_blank" rel="noopener noreferrer" className="font-medium text-[var(--foreground)] underline-offset-4 hover:underline">
            {holder}
          </a>
        </span>
        <span aria-hidden className="hidden sm:inline">
          &middot;
        </span>
        <span>{teams}</span>
      </div>
    </footer>
  );
}

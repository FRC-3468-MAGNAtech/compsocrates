"use client";

import type { ReactNode } from "react";
import NextLink from "next/link";
import { ArrowRight } from "lucide-react";
import Link from "@/components/program/link";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useProgram } from "@/lib/program/context";
import { cn } from "@/lib/utils";

/**
 * The account buttons of the public pages (landing, login, signup, apply, legal), in ONE place so no marketing page can show "Log in" or
 * "Sign up" to someone who is already signed in. Three states, never mixed:
 *  - auth still loading: a neutral placeholder of the same size (no logged-out buttons flashing, no layout jump),
 *  - signed in: "Open dashboard", to the program the person used last (the same last-used program `HomeRedirect` uses),
 *  - signed out: the buttons the page asks for (unchanged from before).
 */
function useAuthSlot(): "loading" | "in" | "out" {
  const { user, loading } = useAuth();
  return loading ? "loading" : user ? "in" : "out";
}

/** Link to the dashboard of the last-used program (`useProgram` outside a program route is the last-used one, safe for hydration). The path is explicit because the public pages sit outside any program. */
export function OpenDashboardButton({ size = "sm", className }: { size?: "sm" | "lg"; className?: string }) {
  const program = useProgram();
  return (
    <NextLink href={`/${program}/dashboard`} className={className}>
      <Button size={size} className="gap-2">
        Open dashboard {size === "lg" && <ArrowRight className="h-4 w-4" />}
      </Button>
    </NextLink>
  );
}

/** Keeps the space of the real buttons while the account state is still unknown. */
function ActionsPlaceholder({ className }: { className?: string }) {
  return <div aria-hidden data-testid="auth-actions-placeholder" className={cn("h-9 w-28 rounded-full bg-white/5", className)} />;
}

/** Header slot: Log in + Sign up when signed out, Open dashboard when signed in, a placeholder while loading. */
export function HeaderAuthActions() {
  const slot = useAuthSlot();
  if (slot === "loading") return <ActionsPlaceholder className="w-[11.5rem]" />;
  if (slot === "in") return <OpenDashboardButton />;
  return (
    <>
      <Link href="/login">
        <Button variant="ghost" size="sm">
          Log in
        </Button>
      </Link>
      <Link href="/signup">
        <Button size="sm">Sign up</Button>
      </Link>
    </>
  );
}

/** Landing hero buttons: Get started + Log in when signed out, Open dashboard when signed in, a placeholder while loading. */
export function HeroAuthActions() {
  const slot = useAuthSlot();
  if (slot === "loading") return <ActionsPlaceholder className="h-11 w-48" />;
  if (slot === "in") return <OpenDashboardButton size="lg" />;
  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      <Link href="/signup">
        <Button size="lg" className="gap-2">
          Get started <ArrowRight className="h-4 w-4" />
        </Button>
      </Link>
      <Link href="/login">
        <Button size="lg" variant="glass">
          Log in
        </Button>
      </Link>
    </div>
  );
}

/** Renders its children only once auth has loaded and nobody is signed in (a "No account? Sign up" line, the closing call to action). */
export function SignedOutOnly({ children }: { children: ReactNode }) {
  return useAuthSlot() === "out" ? <>{children}</> : null;
}

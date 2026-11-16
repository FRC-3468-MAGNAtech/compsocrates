"use client";

import NextLink from "next/link";
import Link from "@/components/program/link";
import { Trophy } from "lucide-react";
import { HeaderAuthActions } from "@/components/marketing/auth-actions";
import { ColorModeToggle } from "@/components/theme/color-mode-toggle";
import { GlassLayerButton } from "@/components/theme/glass-layer-slider";
import { SiteFooter } from "@/components/layout/site-footer";
import { BRAND } from "@/config/brand";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[1400px] flex-col px-4 lg:px-8">
      <header className="glass-panel sticky top-4 z-30 mt-4 flex items-center justify-between px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-xl"
            style={{ background: "var(--theme-gradient)" }}
          >
            <Trophy className="h-[18px] w-[18px] text-[var(--color-primary-foreground)]" />
          </span>
          <span className="text-sm font-semibold sm:text-base">{BRAND.name}</span>
        </Link>
        <div className="flex items-center gap-2 sm:gap-3">
          {/* A plain link on purpose: /credits is the public page, not a program's (the program Link would send it into the app). */}
          <NextLink href="/credits" className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]">
            Credits
          </NextLink>
          <div className="hidden sm:block">
            <ColorModeToggle compact />
          </div>
          <GlassLayerButton compact side="bottom" />
          <HeaderAuthActions />
        </div>
      </header>

      <main className="flex-1">
        {children}
      </main>

      <SiteFooter className="mt-16 py-8" />
    </div>
  );
}

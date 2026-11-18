"use client";

import Link from "@/components/program/link";
import { Award, FlaskConical, UserCircle, UserPlus, Users } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { useAuth } from "@/lib/auth";
import { useProgramConfig } from "@/lib/program/context";
import { PERSONAL_DASHBOARD_TEXT } from "@/lib/personal/strings";

const TILES = [
  { href: "/apply-to-team", icon: Users, title: PERSONAL_DASHBOARD_TEXT.join.title, body: PERSONAL_DASHBOARD_TEXT.join.body },
  { href: "/apply-to-team", icon: UserPlus, title: PERSONAL_DASHBOARD_TEXT.apply.title, body: PERSONAL_DASHBOARD_TEXT.apply.body },
  { href: "/practice-scouting", icon: FlaskConical, title: PERSONAL_DASHBOARD_TEXT.practice.title, body: PERSONAL_DASHBOARD_TEXT.practice.body },
  { href: "/achievements", icon: Award, title: PERSONAL_DASHBOARD_TEXT.achievements.title, body: PERSONAL_DASHBOARD_TEXT.achievements.body },
  { href: "/profile", icon: UserCircle, title: PERSONAL_DASHBOARD_TEXT.profile.title, body: PERSONAL_DASHBOARD_TEXT.profile.body },
] as const;

/**
 * The dashboard of an account with no team in this program (memberships ON): no team data, so no team widgets, only what the person can do now. It is the same
 * component for every program (the program supplies its label). Never an empty screen: there is always something to open here.
 */
export function PersonalDashboard() {
  const { user, profile } = useAuth();
  const config = useProgramConfig();
  const first = (profile?.name ?? user?.displayName ?? "").split(" ")[0] || "scout";
  return (
    <div className="flex flex-col gap-5" data-testid="personal-dashboard">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome, {first}</h1>
        <p className="text-sm text-[var(--muted-foreground)]">{PERSONAL_DASHBOARD_TEXT.intro(config.brand.label)}</p>
      </div>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {TILES.map((tile) => (
          <li key={tile.title}>
            <Link href={tile.href} className="block h-full">
              <GlassPanel className="flex h-full min-h-28 flex-col gap-1.5 transition-colors hover:bg-white/5">
                <span className="flex items-center gap-2 text-base font-semibold">
                  <tile.icon className="h-4 w-4 shrink-0" />
                  {tile.title}
                </span>
                <span className="text-sm text-[var(--muted-foreground)]">{tile.body}</span>
              </GlassPanel>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

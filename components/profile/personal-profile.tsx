"use client";

import { GlassPanel } from "@/components/ui/glass-panel";
import { Avatar } from "@/components/ui/avatar";
import { useAuth } from "@/lib/auth";
import { PERSONAL_PROFILE_NOTE } from "@/lib/personal/strings";

/**
 * Your own profile when you have no team (memberships ON): read-only, with one line saying why. The shared profile document is a team feature (its rules need a
 * team, and nobody else can see it yet), so nothing is written from here and no rule is loosened: the name and email come from your sign-in.
 */
export function PersonalProfile() {
  const { user, profile } = useAuth();
  const name = profile?.name || user?.displayName || (user?.email ?? "").split("@")[0] || "";
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4" data-testid="personal-profile">
      <GlassPanel className="flex items-center gap-4">
        <Avatar name={name} size="lg" />
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold">{name}</h1>
          <p className="truncate text-sm text-[var(--muted-foreground)]">{user?.email ?? ""}</p>
        </div>
      </GlassPanel>
      <p role="note" className="text-sm text-[var(--muted-foreground)]">
        {PERSONAL_PROFILE_NOTE}
      </p>
    </div>
  );
}

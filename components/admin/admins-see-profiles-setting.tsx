"use client";

import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { setAdminsSeeAllProfilesLocal, useAdminsSeeAllProfiles } from "@/lib/profile/admins-see-all";
import { setAdminsSeeAllProfiles } from "@/lib/team-enrollment";

/** Platform-owner-only row (Admin Panel > Platform owner settings): may team admins see every profile on their own team? Default on. */
export function AdminsSeeProfilesSetting() {
  const value = useAdminsSeeAllProfiles();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // Unknown (the public config could not be read) counts as ON, the default. The switch stays usable then: the owner is the one person who can set it.
  const on = value !== false;

  const toggle = async (next: boolean) => {
    setError(null);
    setSaved(false);
    setBusy(true);
    const previous = value;
    setAdminsSeeAllProfilesLocal(next); // shows the new position at once, like the Allow team creation switch above it
    try {
      await setAdminsSeeAllProfiles(next);
      setSaved(true);
    } catch (err) {
      if (previous !== null) setAdminsSeeAllProfilesLocal(previous);
      else setAdminsSeeAllProfilesLocal(true);
      setError(err instanceof Error ? err.message : "Couldn't change this.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2" data-testid="admins-see-profiles-setting">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-medium">Admins can see every profile on their team</div>
          <div className="text-xs text-[var(--muted-foreground)]">
            On by default: a team&apos;s admins can open any teammate&apos;s profile, even a private one, but only on their own team. Turn it off and admins are treated like members.
            Admins can still set their own profile private.
          </div>
        </div>
        <Switch checked={on} onCheckedChange={toggle} disabled={busy} aria-label="Admins can see every profile on their team" />
      </div>
      {saved && !error && (
        <p role="status" className="text-sm text-emerald-400" data-testid="admins-see-profiles-saved">
          Saved. {on ? "Admins can see every profile on their team." : "Admins now see profiles like any member. This needs the updated security rules to be deployed to take effect."}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-400" data-testid="admins-see-profiles-error">
          {error}
        </p>
      )}
    </div>
  );
}

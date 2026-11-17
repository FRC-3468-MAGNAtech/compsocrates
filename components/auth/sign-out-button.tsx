"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

/**
 * The one "Sign out" control for screens a signed-in person can be stuck on (no team yet, request sent, waiting for approval): the shared
 * team-setup frame and the standalone enrollment screen render it, so every such screen has the same way out. It calls the account's own
 * sign-out (`useAuth().logout`), the same flow as the sidebar's; the theme reset that follows a sign-out (`components/theme/theme-provider.tsx`)
 * watches the auth state, so it still runs.
 */
export function SignOutButton({ className }: { className?: string }) {
  const { logout } = useAuth();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const signOut = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await logout();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn("flex flex-col items-center gap-1", className)}>
      <Button type="button" variant="ghost" className="min-h-11 gap-2" onClick={() => void signOut()} disabled={busy} data-testid="sign-out">
        <LogOut className="h-4 w-4" aria-hidden /> {busy ? "Signing out…" : "Sign out"}
      </Button>
      {failed && (
        <p role="alert" className="text-sm text-red-400">
          Could not sign out. Check your connection and try again.
        </p>
      )}
    </div>
  );
}

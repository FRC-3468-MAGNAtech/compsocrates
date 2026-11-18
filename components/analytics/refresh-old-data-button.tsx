"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clearLegacyCache } from "@/lib/legacy-cache";

/**
 * Old entries and practice sessions saved without a team (found through each member's name and id) are looked up once every 6 hours per device, because finding them reads a
 * lot of data. This forgets that copy and reloads the page, which looks them up again. Everything else on the page is already live.
 */
export function RefreshOldDataButton() {
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="gap-2"
      title="Old entries without a team are checked every 6 hours. This checks them now (reloads the page)."
      onClick={() => {
        clearLegacyCache();
        window.location.reload();
      }}
    >
      <RefreshCw className="h-4 w-4" aria-hidden />
      Refresh old entries
    </Button>
  );
}

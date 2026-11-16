"use client";

import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { setAvatarUploadsEnabled } from "@/lib/avatar/client";
import { setAvatarUploadsEnabledLocal, useAvatarSettings } from "@/lib/avatar/settings";

/**
 * Platform-owner-only row (Admin Panel > Platform owner settings): may members upload a profile picture? Default on. Off hides the Upload option and the server
 * refuses uploads; pictures already uploaded keep showing.
 */
export function AvatarUploadsSetting() {
  const settings = useAvatarSettings();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // Unknown (the public config could not be read) counts as ON, the default. The owner is the one person who can set it.
  const on = settings.uploadsEnabled !== false;

  const toggle = async (next: boolean) => {
    setError(null);
    setSaved(false);
    setBusy(true);
    const previous = settings.uploadsEnabled;
    setAvatarUploadsEnabledLocal(next);
    try {
      await setAvatarUploadsEnabled(next);
      setSaved(true);
    } catch (err) {
      setAvatarUploadsEnabledLocal(previous ?? true);
      setError(err instanceof Error ? err.message : "Couldn't change this.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2" data-testid="avatar-uploads-setting">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-medium">Profile picture uploads</div>
          <div className="text-xs text-[var(--muted-foreground)]">
            On by default: members can upload a photo in Account Settings. Turn it off and the Upload option disappears and the server refuses uploads. Photos already uploaded keep showing, and admins can still remove them.
            {settings.loaded && settings.blobHost === null && " Uploads are not set up on this server yet (the picture store token is missing), so nobody can upload either way."}
          </div>
        </div>
        <Switch checked={on} onCheckedChange={toggle} disabled={busy} aria-label="Profile picture uploads" />
      </div>
      {saved && !error && (
        <p role="status" className="text-sm text-emerald-400" data-testid="avatar-uploads-saved">
          Saved. {on ? "Members can upload a photo." : "The Upload option is hidden and uploads are refused."}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-400" data-testid="avatar-uploads-error">
          {error}
        </p>
      )}
    </div>
  );
}

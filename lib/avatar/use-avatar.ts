"use client";

import { useContext } from "react";
import { AuthContext } from "@/lib/auth";
import { canViewerSeePhoto, resolveAvatar, type AvatarInput, type ResolvedAvatar } from "@/lib/avatar/model";
import { useAvatarSettings } from "@/lib/avatar/settings";
import { useAdminsSeeAllProfiles } from "@/lib/profile/admins-see-all";

/**
 * What the shared Avatar draws for this input, for THIS viewer: the Session 8 resolveAvatar with the store host from the public config and the Session G profile
 * visibility function. Outside an AuthProvider (isolated component tests) there is no viewer, so a private profile's photo is not shown.
 */
export function useResolvedAvatar(avatar: AvatarInput | null | undefined, hidePhoto = false): ResolvedAvatar {
  const settings = useAvatarSettings();
  const adminsSeeAll = useAdminsSeeAllProfiles();
  const auth = useContext(AuthContext);
  const up = avatar?.upload;
  const viewerCanSeePhoto =
    hidePhoto || !up
      ? !hidePhoto
      : canViewerSeePhoto({
          viewerUid: auth?.user?.uid ?? null,
          viewerIsAdmin: !!auth?.profile?.isAdmin,
          viewerIsPlatformOwner: !!auth?.profile?.isPlatformOwner,
          adminsSeeAll,
          targetUid: up.uid,
          visibility: up.visibility,
        });
  return resolveAvatar({ avatar, storeHost: settings.blobHost, viewerCanSeePhoto });
}

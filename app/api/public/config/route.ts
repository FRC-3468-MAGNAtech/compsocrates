import { NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { avatarStoreHost } from "@/lib/server/avatar-blobs";
import { getAdminsSeeAllProfiles, getAvatarUploadsEnabled, getTeamCreationEnabled } from "@/lib/server/team-settings";

/**
 * The one piece of server state the logged-out Signup page needs (whether
 * to show "Create a team") — deliberately not a Firestore read from the
 * client: `teams` and `appSettings` are both fully locked down to clients
 * in firestore.rules, so this is the only
 * way an unauthenticated visitor learns the flag.
 *
 * Every flag here is read-only: this route never writes appSettings/global. `teamCreationEnabled` and `avatarUploadsEnabled` are OFF when the field or the
 * document is missing (beta release decision); `adminsSeeAllProfiles` is ON when missing.
 *
 * Session 8 adds the picture settings: `avatarUploadsEnabled` (the owner's switch, missing = off) and `avatarBlobHost` (the one host the app's uploaded pictures
 * are served from, or null when uploads are not set up on this server). The browser trusts an uploaded picture only on that host.
 */
export async function GET() {
  const avatarBlobHost = avatarStoreHost();
  const db = getAdminFirestore();
  if (!db) {
    // Firebase Admin isn't configured — fail closed (no Create option)
    // rather than guessing, same convention as lib/server/require-user.ts.
    return NextResponse.json({ teamCreationEnabled: false, adminsSeeAllProfiles: true, avatarUploadsEnabled: false, avatarBlobHost });
  }
  const teamCreationEnabled = await getTeamCreationEnabled(db);
  const adminsSeeAllProfiles = await getAdminsSeeAllProfiles(db);
  const avatarUploadsEnabled = await getAvatarUploadsEnabled(db);
  return NextResponse.json({ teamCreationEnabled, adminsSeeAllProfiles, avatarUploadsEnabled, avatarBlobHost });
}

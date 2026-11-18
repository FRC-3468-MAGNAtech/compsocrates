"use client";

import { ProfileView } from "@/components/profile/profile-view";
import { PersonalProfile } from "@/components/profile/personal-profile";
import { useAuth } from "@/lib/auth";
import { usePersonalMode } from "@/lib/personal/context";

/** Your own profile: the same page teammates see, plus Edit and "View as others see it". */
export default function OwnProfilePage() {
  const { user } = useAuth();
  const { personal } = usePersonalMode();
  if (!user) return null;
  // No team (memberships ON): a read-only page; the shared profile is a team feature.
  if (personal) return <PersonalProfile />;
  return <ProfileView uid={user.uid} />;
}

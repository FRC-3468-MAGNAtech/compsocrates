"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import LoadingSpinner from "@/app/components/LoadingSpinner";

type UserProfile = {
  uid: string;
  displayName: string;
  email: string;
  role: string;
  specialRole?: string;
  teamId?: string;
  photoURL?: string;
};

type TeamDoc = {
  teamName?: string;
  teamNumber?: string;
};

function ProfileContent() {
  const params = useParams<{ userId: string }>();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [teamLabel, setTeamLabel] = useState("No team");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadProfile() {
      if (!params?.userId) return;
      setLoading(true);
      try {
        const userSnap = await getDoc(doc(db, "users", params.userId));
        if (!userSnap.exists()) {
          setProfile(null);
          return;
        }
        const user = userSnap.data() as UserProfile;
        setProfile(user);

        if (user.teamId) {
          const teamSnap = await getDoc(doc(db, "teams", user.teamId));
          if (teamSnap.exists()) {
            const teamData = teamSnap.data() as TeamDoc;
          setTeamLabel(teamData.teamNumber || teamData.teamName || user.teamId);
          } else {
            setTeamLabel(user.teamId);
          }
        }
      } finally {
        setLoading(false);
      }
    }
    loadProfile();
  }, [params?.userId]);

  if (loading) {
    return (
      <div className="flex h-screen bg-gray-100">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center">
          <LoadingSpinner message="Loading profile..." />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-y-auto p-8">
        {!profile ? (
          <div className="bg-white rounded-xl shadow-md p-8 text-center">Profile not found.</div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-6">
            <div className="bg-white rounded-xl shadow-md p-6">
              <h1 className="text-3xl font-bold theme-text mb-2">{profile.displayName}</h1>
              <p className="text-gray-600">{profile.email}</p>
              <p className="text-sm text-gray-500 capitalize mt-1">
                {profile.specialRole ? profile.specialRole.replace(/-/g, " ") : profile.role}
              </p>
            </div>
            <div className="bg-white rounded-xl shadow-md p-6">
              <h2 className="text-xl font-semibold mb-3">Team</h2>
              <p className="text-lg font-medium">Team {teamLabel}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <ProtectedRoute requireAuth={true}>
      <ProfileContent />
    </ProtectedRoute>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import { useAuth } from "@/app/AuthContext";

type UserProfile = {
  uid: string;
  displayName: string;
  email: string;
  role: string;
  specialRole?: string;
  profileVisibility?: "team" | "public" | "private";
  bio?: string;
  teamId?: string;
  photoURL?: string;
};

type TeamDoc = {
  teamName?: string;
  teamNumber?: string;
};

function ProfileContent() {
  const params = useParams<{ userId: string }>();
  const { userData } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [teamLabel, setTeamLabel] = useState("No team");
  const [canView, setCanView] = useState(true);
  const [stats, setStats] = useState({
    totalEntries: 0,
    practiceSessions: 0,
    avgAccuracy: 0,
    eventsScouted: 0,
  });
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
        const visibility = user.profileVisibility || "team";
        const sameUser = userData?.uid === user.uid;
        const sameTeam = Boolean(userData?.teamId && user.teamId && userData.teamId === user.teamId);
        const visible =
          visibility === "public" ||
          sameUser ||
          (visibility === "team" && sameTeam);
        setCanView(visible);

        if (!visible) return;

        if (user.teamId) {
          const teamSnap = await getDoc(doc(db, "teams", user.teamId));
          if (teamSnap.exists()) {
            const teamData = teamSnap.data() as TeamDoc;
          setTeamLabel(teamData.teamNumber || teamData.teamName || user.teamId);
          } else {
            setTeamLabel(user.teamId);
          }
        }

        const [scoutingSnap, practiceSnap] = await Promise.all([
          getDocs(query(collection(db, "scouting"), where("scoutName", "==", user.displayName))),
          getDocs(query(collection(db, "practiceSessions"), where("scoutName", "==", user.displayName))),
        ]);

        const eventKeys = new Set<string>();
        scoutingSnap.docs.forEach((entryDoc) => {
          const entry = entryDoc.data();
          if (entry.eventKey) eventKeys.add(entry.eventKey);
        });

        let accuracyTotal = 0;
        let accuracyCount = 0;
        practiceSnap.docs.forEach((sessionDoc) => {
          const session = sessionDoc.data();
          if (typeof session.accuracy === "number") {
            accuracyTotal += session.accuracy;
            accuracyCount += 1;
          }
        });

        setStats({
          totalEntries: scoutingSnap.size,
          practiceSessions: practiceSnap.size,
          avgAccuracy: accuracyCount > 0 ? Math.round(accuracyTotal / accuracyCount) : 0,
          eventsScouted: eventKeys.size,
        });
      } finally {
        setLoading(false);
      }
    }
    loadProfile();
  }, [params?.userId, userData?.teamId, userData?.uid]);

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
        ) : !canView ? (
          <div className="bg-white rounded-xl shadow-md p-8 text-center">
            This profile is private or restricted to team members.
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-6">
            <div className="bg-white rounded-xl shadow-md p-6">
              <div className="flex items-center gap-4">
                {profile.photoURL ? (
                  <img src={profile.photoURL} alt={profile.displayName} className="w-20 h-20 rounded-full object-cover border border-gray-200" />
                ) : (
                  <div className="w-20 h-20 rounded-full bg-gray-200 flex items-center justify-center text-xl font-bold">
                    {profile.displayName.slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div>
                  <h1 className="text-3xl font-bold theme-text mb-1">{profile.displayName}</h1>
                  <p className="text-gray-600">{profile.email}</p>
                  <p className="text-sm text-gray-500 capitalize mt-1">
                    {profile.specialRole ? profile.specialRole.replace(/-/g, " ") : profile.role}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">Visibility: {profile.profileVisibility || "team"}</p>
                </div>
              </div>
              {profile.bio && (
                <div className="mt-4 p-3 rounded-lg border border-gray-200">
                  <p className="text-sm text-gray-700">{profile.bio}</p>
                </div>
              )}
            </div>
            <div className="bg-white rounded-xl shadow-md p-6">
              <h2 className="text-xl font-semibold mb-3">Team</h2>
              <p className="text-lg font-medium">Team {teamLabel}</p>
            </div>
            <div className="bg-white rounded-xl shadow-md p-6">
              <h2 className="text-xl font-semibold mb-3">Stats</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
                <div className="p-3 border border-gray-200 rounded-lg">
                  <p className="text-xs text-gray-500">Entries</p>
                  <p className="text-2xl font-bold">{stats.totalEntries}</p>
                </div>
                <div className="p-3 border border-gray-200 rounded-lg">
                  <p className="text-xs text-gray-500">Practice</p>
                  <p className="text-2xl font-bold">{stats.practiceSessions}</p>
                </div>
                <div className="p-3 border border-gray-200 rounded-lg">
                  <p className="text-xs text-gray-500">Avg Accuracy</p>
                  <p className="text-2xl font-bold">{stats.avgAccuracy}%</p>
                </div>
                <div className="p-3 border border-gray-200 rounded-lg">
                  <p className="text-xs text-gray-500">Events</p>
                  <p className="text-2xl font-bold">{stats.eventsScouted}</p>
                </div>
              </div>
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

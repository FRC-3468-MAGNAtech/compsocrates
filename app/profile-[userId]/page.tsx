"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { doc, getDoc, collection, query, where, getDocs } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { User, Trophy, Target, Calendar, Award } from "lucide-react";

interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  role: "scout" | "coach";
  specialRole?: string;
  teamId: string;
  isTeamAdmin: boolean;
  profilePicture?: string;
  createdAt: number;
}

interface UserStats {
  matchesScouted: number;
  averageAccuracy: number;
  practiceSessionsCompleted: number;
  recentActivity: any[];
}

function ProfileContent() {
  const params = useParams();
  const userId = params.userId as string;
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [teamName, setTeamName] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProfile();
  }, [userId]);

  async function loadProfile() {
    setLoading(true);
    try {
      // Load user profile
      const userDoc = await getDoc(doc(db, "users", userId));
      if (!userDoc.exists()) {
        setLoading(false);
        return;
      }

      const userData = { uid: userDoc.id, ...userDoc.data() } as UserProfile;
      setProfile(userData);

      // Load team name
      if (userData.teamId) {
        const teamDoc = await getDoc(doc(db, "teams", userData.teamId));
        if (teamDoc.exists()) {
          setTeamName(teamDoc.data().teamName || userData.teamId);
        }
      }

      // Load stats
      const entriesQuery = query(
        collection(db, "scoutingEntries"),
        where("scoutName", "==", userData.displayName)
      );
      const entriesSnap = await getDocs(entriesQuery);
      const matchesScouted = entriesSnap.size;

      const practiceQuery = query(
        collection(db, "practiceSessions"),
        where("scoutName", "==", userData.displayName)
      );
      const practiceSnap = await getDocs(practiceQuery);
      
      let totalAccuracy = 0;
      practiceSnap.forEach(doc => {
        const data = doc.data();
        if (data.accuracy) totalAccuracy += data.accuracy;
      });
      const averageAccuracy = practiceSnap.size > 0 ? Math.round(totalAccuracy / practiceSnap.size) : 0;

      // Recent activity
      const recentEntries = entriesSnap.docs
        .map(doc => doc.data())
        .sort((a, b) => (b.submittedAt || b.timestamp || 0) - (a.submittedAt || a.timestamp || 0))
        .slice(0, 5);

      setStats({
        matchesScouted,
        averageAccuracy,
        practiceSessionsCompleted: practiceSnap.size,
        recentActivity: recentEntries,
      });
    } catch (error) {
      console.error("Error loading profile:", error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-screen bg-gray-100">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-4xl animate-spin">🔄</div>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex h-screen bg-gray-100">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <User size={64} className="mx-auto mb-4 text-gray-400" />
            <h2 className="text-2xl font-bold text-gray-700">User Not Found</h2>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-y-auto p-4 md:p-8">
        {/* Profile Header */}
        <div className="bg-white rounded-xl shadow-md p-6 mb-6">
          <div className="flex items-start gap-6">
            {/* Profile Picture */}
            <div className="flex-shrink-0">
              {profile.profilePicture ? (
                <img
                  src={profile.profilePicture}
                  alt={profile.displayName}
                  className="w-24 h-24 rounded-full object-cover"
                />
              ) : (
                <div className="w-24 h-24 rounded-full bg-gradient-to-br from-red-400 to-red-600 flex items-center justify-center text-white text-3xl font-bold">
                  {profile.displayName.substring(0, 2).toUpperCase()}
                </div>
              )}
            </div>

            {/* Info */}
            <div className="flex-1">
              <h1 className="text-3xl font-bold mb-2">{profile.displayName}</h1>
              <div className="flex flex-wrap gap-2 mb-3">
                <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm font-semibold capitalize">
                  {profile.specialRole ? profile.specialRole.replace(/-/g, ' ') : profile.role}
                </span>
                {profile.isTeamAdmin && (
                  <span className="px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-sm font-semibold">
                    Team Admin
                  </span>
                )}
              </div>
              <p className="text-gray-600">Team {teamName}</p>
              <p className="text-sm text-gray-500 mt-2">
                Member since {new Date(profile.createdAt).toLocaleDateString()}
              </p>
            </div>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid md:grid-cols-3 gap-6 mb-6">
          <div className="bg-white rounded-xl shadow-md p-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-gray-700">Matches Scouted</h3>
              <Trophy className="text-blue-500" size={24} />
            </div>
            <p className="text-4xl font-bold" style={{ color: "#c42221" }}>
              {stats?.matchesScouted || 0}
            </p>
          </div>

          <div className="bg-white rounded-xl shadow-md p-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-gray-700">Accuracy</h3>
              <Target className="text-green-500" size={24} />
            </div>
            <p className="text-4xl font-bold" style={{ color: "#c42221" }}>
              {stats?.averageAccuracy || 0}%
            </p>
          </div>

          <div className="bg-white rounded-xl shadow-md p-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-gray-700">Practice Sessions</h3>
              <Award className="text-yellow-500" size={24} />
            </div>
            <p className="text-4xl font-bold" style={{ color: "#c42221" }}>
              {stats?.practiceSessionsCompleted || 0}
            </p>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-white rounded-xl shadow-md p-6">
          <div className="flex items-center gap-2 mb-4">
            <Calendar className="text-gray-400" size={20} />
            <h2 className="text-xl font-bold">Recent Activity</h2>
          </div>

          {!stats?.recentActivity || stats.recentActivity.length === 0 ? (
            <p className="text-center py-8 text-gray-500">No recent activity</p>
          ) : (
            <div className="space-y-3">
              {stats.recentActivity.map((entry, i) => (
                <div key={i} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-medium">
                      Scouted Team {entry.teamNumber}
                    </p>
                    <p className="text-sm text-gray-600">
                      Match {entry.matchId || entry.matchNumber}
                    </p>
                  </div>
                  <div className="text-sm text-gray-500">
                    {new Date(entry.submittedAt || entry.timestamp).toLocaleDateString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
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

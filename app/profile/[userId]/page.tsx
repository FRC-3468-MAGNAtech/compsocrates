"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import LoadingSpinner from "@/app/components/LoadingSpinner";

type ProfileData = {
  uid: string;
  displayName: string;
  email: string;
  role: string;
  specialRole?: string | null;
  photoURL?: string;
  teamId?: string;
};

function ProfilePageContent() {
  const params = useParams<{ userId: string }>();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [entriesCount, setEntriesCount] = useState(0);
  const [practiceCount, setPracticeCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadProfile() {
      if (!params?.userId) return;

      setLoading(true);
      try {
        const userRef = doc(db, "users", params.userId);
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) {
          setProfile(null);
          return;
        }

        const data = userSnap.data() as ProfileData;
        setProfile(data);

        const [entriesSnap, practiceSnap] = await Promise.all([
          getDocs(query(collection(db, "scouting"), where("scoutName", "==", data.displayName))),
          getDocs(query(collection(db, "practiceSessions"), where("scoutName", "==", data.displayName))),
        ]);

        setEntriesCount(entriesSnap.size);
        setPracticeCount(practiceSnap.size);
      } catch (error) {
        console.error("Error loading profile:", error);
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

  if (!profile) {
    return (
      <div className="flex h-screen bg-gray-100">
        <Sidebar />
        <div className="flex-1 p-8">
          <div className="bg-white rounded-xl shadow-md p-8 text-center">
            <h1 className="text-2xl font-semibold mb-2">Profile Not Found</h1>
            <p className="text-gray-600">This user profile does not exist.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-3xl mx-auto space-y-6">
          <div className="bg-white rounded-xl shadow-md p-6">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-gray-300 flex items-center justify-center text-xl font-bold text-gray-700 overflow-hidden">
                {profile.photoURL ? (
                  <img src={profile.photoURL} alt="Profile" className="w-full h-full object-cover" />
                ) : (
                  profile.displayName.slice(0, 2).toUpperCase()
                )}
              </div>
              <div>
                <h1 className="text-2xl font-bold">{profile.displayName}</h1>
                <p className="text-gray-600">{profile.email}</p>
                <p className="text-sm text-gray-500 capitalize">
                  {profile.specialRole ? profile.specialRole.replace(/-/g, " ") : profile.role}
                </p>
              </div>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            <div className="bg-white rounded-xl shadow-md p-5">
              <p className="text-sm text-gray-600 mb-1">Team</p>
              <p className="text-xl font-semibold">{profile.teamId || "No team"}</p>
            </div>
            <div className="bg-white rounded-xl shadow-md p-5">
              <p className="text-sm text-gray-600 mb-1">Scouting Entries</p>
              <p className="text-xl font-semibold">{entriesCount}</p>
            </div>
            <div className="bg-white rounded-xl shadow-md p-5">
              <p className="text-sm text-gray-600 mb-1">Practice Sessions</p>
              <p className="text-xl font-semibold">{practiceCount}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <ProtectedRoute requireAuth={true}>
      <ProfilePageContent />
    </ProtectedRoute>
  );
}

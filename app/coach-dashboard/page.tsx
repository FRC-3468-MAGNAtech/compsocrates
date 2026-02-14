// FILE: app/coach-dashboard/page.tsx
// COMPLETE REWRITE - Scout counter with input, lead scouts counted

"use client";

import { useState, useEffect } from "react";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import { Users, Target, Calendar, TrendingUp } from "lucide-react";
import { isEventActive, getCurrentEvent } from "@/app/utils/eventDates";

// Type definition for user data from Firestore
interface TeamMember {
  uid: string;
  role: string;
  specialRole?: string;
  [key: string]: any;
}

function CoachDashboardContent() {
  const { userData } = useAuth();
  const [scoutCount, setScoutCount] = useState(0);
  const [expectedScouts, setExpectedScouts] = useState(() => {
    if (typeof window !== 'undefined') {
      return parseInt(localStorage.getItem('expectedScouts') || '8');
    }
    return 8;
  });
  const [verifiedCount, setVerifiedCount] = useState(0);
  const [recentEntries, setRecentEntries] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('expectedScouts', expectedScouts.toString());
    }
  }, [expectedScouts]);

  useEffect(() => {
    loadDashboardData();
  }, [userData?.teamId]);

  async function loadDashboardData() {
    if (!userData?.teamId) return;

    try {
      // Get all team members
      const usersQuery = query(
        collection(db, "users"),
        where("teamId", "==", userData.teamId)
      );
      const usersSnap = await getDocs(usersQuery);
      const allUsers = usersSnap.docs.map(doc => ({ uid: doc.id, ...doc.data() })) as TeamMember[];

      // Count scouts + lead scouts
      const scouts = allUsers.filter(u => 
        u.role === "scout" || (u.role === "coach" && u.specialRole === "Lead Scout")
      );
      setScoutCount(scouts.length);

      // Get practice sessions
      const sessionsSnap = await getDocs(collection(db, "practiceSessions"));
      const sessions = sessionsSnap.docs.map(doc => doc.data());

      // Count verified scouts (80%+ accuracy)
      const scoutAccuracies = scouts.map(scout => {
        const scoutSessions = sessions.filter((s: any) => s.scoutId === scout.uid);
        if (scoutSessions.length === 0) return 0;
        return Math.round(
          scoutSessions.reduce((sum: number, s: any) => sum + (s.accuracy || 0), 0) / scoutSessions.length
        );
      });
      setVerifiedCount(scoutAccuracies.filter(a => a >= 80).length);

      // Count recent scouting entries (last 7 days)
      const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
      const scoutingQuery = query(
        collection(db, "scouting"),
        where("teamId", "==", userData.teamId)
      );
      const scoutingSnap = await getDocs(scoutingQuery);
      const recentScoutingEntries = scoutingSnap.docs.filter(doc => {
        const data = doc.data();
        return data.timestamp && data.timestamp > sevenDaysAgo;
      });
      setRecentEntries(recentScoutingEntries.length);
    } catch (error) {
      console.error("Error loading dashboard data:", error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-screen">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center">
          <LoadingSpinner size="large" message="Loading dashboard..." />
        </div>
      </div>
    );
  }

  const eventActive = isEventActive();
  const currentEvent = getCurrentEvent();

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      <div className="flex-1 overflow-auto">
        <div className="p-8">
          <div className="mb-8">
            <h1 className="text-3xl font-bold mb-2" style={{ color: "#c42221" }}>
              Coach Dashboard
            </h1>
            <p className="text-gray-600">
              Overview of your team's scouting activity
            </p>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            {/* Current Event Status */}
            <div className="bg-white rounded-xl shadow-md p-6">
              <div className="flex items-center justify-between mb-4">
                <Calendar className="text-blue-500" size={32} />
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                  eventActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                }`}>
                  {eventActive ? 'Active' : 'Inactive'}
                </span>
              </div>
              <div>
                <p className="text-2xl font-bold mb-1">
                  {currentEvent?.name || 'No Event'}
                </p>
                {eventActive && currentEvent && (
                  <p className="text-sm text-gray-700 mt-1">
                    Event in progress
                  </p>
                )}
                {!eventActive && currentEvent && (
                  <p className="text-sm text-gray-700 mt-1">
                    Next event starts in {Math.ceil((Number(currentEvent.startDate) - Date.now()) / (1000 * 60 * 60 * 24))} days
                  </p>
                )}
              </div>
            </div>

            {/* Scout Count with Input */}
            <div className="bg-white rounded-xl shadow-md p-6">
              <div className="flex items-center justify-between mb-4">
                <Users className="text-purple-500" size={32} />
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                  scoutCount >= expectedScouts ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                }`}>
                  {scoutCount >= expectedScouts ? 'Ready' : 'Below Target'}
                </span>
              </div>
              <div>
                <div className="flex items-baseline gap-2 mb-2">
                  <p className="text-2xl font-bold">{scoutCount}</p>
                  <span className="text-gray-500">/</span>
                  <input
                    type="number"
                    min="1"
                    value={expectedScouts}
                    onChange={(e) => setExpectedScouts(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-16 text-xl font-bold border-b-2 border-gray-300 focus:border-blue-500 outline-none text-center"
                    style={{ color: "#c42221" }}
                  />
                </div>
                <p className="text-sm text-gray-600">
                  Scouts Available
                </p>
              </div>
            </div>

            {/* Verified Scouts */}
            <div className="bg-white rounded-xl shadow-md p-6">
              <div className="flex items-center justify-between mb-4">
                <Target className="text-green-500" size={32} />
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                  verifiedCount >= Math.ceil(scoutCount * 0.75) ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                }`}>
                  {verifiedCount >= Math.ceil(scoutCount * 0.75) ? 'Good' : 'Needs Work'}
                </span>
              </div>
              <div>
                <p className="text-2xl font-bold mb-1">
                  {verifiedCount}
                </p>
                <p className="text-sm text-gray-600">
                  Verified Scouts (80%+ accuracy)
                </p>
              </div>
            </div>

            {/* Recent Activity */}
            <div className="bg-white rounded-xl shadow-md p-6">
              <div className="flex items-center justify-between mb-4">
                <TrendingUp style={{ color: "#c42221" }} size={32} />
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                  recentEntries > 0 ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                }`}>
                  {recentEntries > 0 ? 'Active' : 'Quiet'}
                </span>
              </div>
              <div>
                <p className="text-2xl font-bold mb-1">
                  {recentEntries}
                </p>
                <p className="text-sm text-gray-600">
                  Entries (Last 7 days)
                </p>
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="bg-white rounded-xl shadow-md p-6">
            <h2 className="text-xl font-semibold mb-4">Quick Actions</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <a
                href="/scout-form"
                className="p-4 border-2 border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-all text-center"
              >
                <p className="font-semibold mb-1">Scout a Match</p>
                <p className="text-sm text-gray-600">Fill out a scouting form</p>
              </a>
              <a
                href="/analytics"
                className="p-4 border-2 border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-all text-center"
              >
                <p className="font-semibold mb-1">View Analytics</p>
                <p className="text-sm text-gray-600">Analyze team performance</p>
              </a>
              <a
                href="/team-management"
                className="p-4 border-2 border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-all text-center"
              >
                <p className="font-semibold mb-1">Manage Team</p>
                <p className="text-sm text-gray-600">Add or remove scouts</p>
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["coach"]}>
      <CoachDashboardContent />
    </ProtectedRoute>
  );
}

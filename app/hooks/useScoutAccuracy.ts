// FILE: app/hooks/useScoutAccuracy.ts
// COMPLETE REWRITE - Lead scouts counted, everyone tracked

"use client";

import { useState, useEffect } from "react";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "@/app/firebase";

export interface ScoutAccuracy {
  uid: string;
  displayName: string;
  email: string;
  role: string;
  specialRole?: string;
  practiceSessionsCompleted: number;
  averageAccuracy: number;
  lastPracticeDate?: number;
}

export function useScoutAccuracy(teamId: string | undefined) {
  const [scouts, setScouts] = useState<ScoutAccuracy[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalScouts, setTotalScouts] = useState(0);

  useEffect(() => {
    if (!teamId) {
      setLoading(false);
      return;
    }

    async function loadScoutAccuracy() {
      try {
        // Get all team members
        const usersQuery = query(
          collection(db, "users"),
          where("teamId", "==", teamId)
        );
        const usersSnap = await getDocs(usersQuery);
        const allUsers = usersSnap.docs.map(doc => ({
          uid: doc.id,
          ...doc.data()
        })) as any[];

        // Count scouts + lead scouts ONLY for total
        const scoutsOnly = allUsers.filter(u => 
          u.role === "scout" || (u.role === "coach" && u.specialRole === "Lead Scout")
        );
        setTotalScouts(scoutsOnly.length);

        // Get practice sessions for ALL users (everyone shows on leaderboard)
        const sessionsSnap = await getDocs(collection(db, "practiceSessions"));
        const sessions = sessionsSnap.docs.map(doc => doc.data());

        // Calculate accuracy for each user
        const scoutAccuracies: ScoutAccuracy[] = allUsers.map(user => {
          const userSessions = sessions.filter(s => s.scoutId === user.uid);
          const completedSessions = userSessions.length;
          const avgAccuracy = completedSessions > 0
            ? Math.round(
                userSessions.reduce((sum, s) => sum + (s.accuracy || 0), 0) / completedSessions
              )
            : 0;
          const lastSession = userSessions.length > 0
            ? Math.max(...userSessions.map(s => s.timestamp || 0))
            : undefined;

          return {
            uid: user.uid,
            displayName: user.displayName || "Unknown",
            email: user.email || "",
            role: user.role || "scout",
            specialRole: user.specialRole,
            practiceSessionsCompleted: completedSessions,
            averageAccuracy: avgAccuracy,
            lastPracticeDate: lastSession,
          };
        });

        // Sort by accuracy, then by sessions
        scoutAccuracies.sort((a, b) => {
          if (b.averageAccuracy !== a.averageAccuracy) {
            return b.averageAccuracy - a.averageAccuracy;
          }
          return b.practiceSessionsCompleted - a.practiceSessionsCompleted;
        });

        setScouts(scoutAccuracies);
      } catch (error) {
        console.error("Error loading scout accuracy:", error);
      } finally {
        setLoading(false);
      }
    }

    loadScoutAccuracy();
  }, [teamId]);

  return { scouts, loading, totalScouts };
}

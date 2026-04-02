import { useState, useEffect } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/app/firebase';
import { getUserRoles } from '@/app/utils/roles';

interface ScoutAccuracyData {
  totalScouts: number;
  avgAccuracy: number;
  totalPracticeSessions: number;
  totalEntries: number;
}

export function useScoutAccuracy(teamId?: string) {
  const [data, setData] = useState<ScoutAccuracyData>({
    totalScouts: 0,
    avgAccuracy: 0,
    totalPracticeSessions: 0,
    totalEntries: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        // Get all users (we need to count scouts AND lead scouts)
        let usersQuery;
        if (teamId) {
          usersQuery = query(collection(db, 'users'), where('teamId', '==', teamId));
        } else {
          usersQuery = collection(db, 'users');
        }
        
        const usersSnapshot = await getDocs(usersQuery);
        const users = usersSnapshot.docs.map(doc => doc.data());
        
        // Count match scouts + lead scouts from the new role model.
        const totalScouts = users.filter((u: Record<string, unknown>) => 
          (() => {
            const roles = getUserRoles({
              role: String(u.role || ''),
              roles: u.roles as string[] | undefined,
              secondaryRoles: u.secondaryRoles as string[] | undefined,
            });
            return roles.includes('match-scout') || roles.includes('media') || roles.includes('lead-scout');
          })()
        ).length;
        
        // Get all practice sessions
        const practiceSnapshot = await getDocs(collection(db, 'practiceSessions'));
        const practiceSessions = practiceSnapshot.docs.map(doc => doc.data());
        
        // Get all scouting entries
        const scoutingSnapshot = await getDocs(collection(db, 'scouting'));
        const scoutingEntries = scoutingSnapshot.docs.map(doc => doc.data());
        
        // Calculate average accuracy from practice sessions
        const accuracies = practiceSessions.map((s: Record<string, unknown>) => Number(s.accuracy || 0));
        const avgAccuracy = accuracies.length > 0
          ? Math.round(accuracies.reduce((a, b) => a + b, 0) / accuracies.length)
          : 0;
        
        setData({
          totalScouts,
          avgAccuracy,
          totalPracticeSessions: practiceSessions.length,
          totalEntries: scoutingEntries.length,
        });
      } catch (error) {
        console.error('Error fetching scout accuracy:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [teamId]);

  return { ...data, loading };
}

import { useState, useEffect } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/app/firebase';

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
        
        const normalize = (value: string | null | undefined) =>
          (value || "").toLowerCase().replace(/\s+/g, "-");

        // Count scouts + lead scouts (legacy and normalized values)
        const totalScouts = users.filter((u: any) => 
          u.role === 'scout' || 
          normalize(u.specialRole) === 'lead-scout' ||
          Array.isArray(u.specialRoles) && u.specialRoles.map(normalize).includes('lead-scout')
        ).length;
        
        // Get all practice sessions
        const practiceSnapshot = await getDocs(collection(db, 'practiceSessions'));
        const practiceSessions = practiceSnapshot.docs.map(doc => doc.data());
        
        // Get all scouting entries
        const scoutingSnapshot = await getDocs(collection(db, 'scouting'));
        const scoutingEntries = scoutingSnapshot.docs.map(doc => doc.data());
        
        // Calculate average accuracy from practice sessions
        const accuracies = practiceSessions.map((s: any) => s.accuracy || 0);
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

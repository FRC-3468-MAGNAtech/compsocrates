import { useState, useEffect } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/app/firebase';

interface ScoutAccuracyData {
  totalScouts: number;
  avgAccuracy: number;
  totalPracticeSessions: number;
  totalEntries: number;
}

export function useScoutAccuracy() {
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
        // Get all practice sessions
        const practiceSnapshot = await getDocs(collection(db, 'practice-sessions'));
        const practiceSessions = practiceSnapshot.docs.map(doc => doc.data());
        
        // Get all scouting entries
        const scoutingSnapshot = await getDocs(collection(db, 'scouting'));
        const scoutingEntries = scoutingSnapshot.docs.map(doc => doc.data());
        
        // Calculate unique scouts
        const uniqueScouts = new Set(scoutingEntries.map((e: any) => e.scoutName)).size;
        
        // Calculate average accuracy from practice sessions
        const accuracies = practiceSessions.map((s: any) => s.accuracy || 0);
        const avgAccuracy = accuracies.length > 0
          ? Math.round(accuracies.reduce((a, b) => a + b, 0) / accuracies.length)
          : 0;
        
        setData({
          totalScouts: uniqueScouts,
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
  }, []);

  return { ...data, loading };
}
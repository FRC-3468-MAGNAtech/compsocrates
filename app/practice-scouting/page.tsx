"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { collection, addDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";

// ==========================================
// TYPE DEFINITIONS
// ==========================================

interface PracticeMatch {
  id?: string;
  matchKey?: string;
  eventName?: string;
  eventKey?: string;
  matchNumber: number;
  matchType: 'qualification' | 'playoff' | 'practice';
  videoUrl: string;
  difficulty: 'easy' | 'medium' | 'hard';
  alliance: 'red' | 'blue';
  allianceScore?: number;
  teamPosition?: number;
  teamNumber: number;
  actualData: {
    teamNumber: string;
    startingPosition: string;
    leftStartingZone: boolean;
    autoCoralMissed: number;
    autoCoralL1: number;
    autoCoralL2: number;
    autoCoralL3: number;
    autoCoralL4: number;
    autoAlgaeProcessorMissed: number;
    autoAlgaeProcessorScored: number;
    autoAlgaeNetMissed: number;
    autoAlgaeNetScored: number;
    teleopCoralMissed: number;
    teleopCoralL1: number;
    teleopCoralL2: number;
    teleopCoralL3: number;
    teleopCoralL4: number;
    teleopAlgaeRemoved: boolean;
    teleopProcessorMissed: number;
    teleopProcessorScored: number;
    teleopNetRobotMissed: number;
    teleopNetRobotScored: number;
    teleopNetHumanMissed: number;
    teleopNetHumanScored: number;
    failedClimb: number;
    stageStatus: string;
    incidents: string[];
    notes: string;
  };
  actualScore: number;
  createdAt?: number;
}

interface PracticeSession {
  id?: string;
  scoutName: string;
  scoutId?: string;
  matchId?: string;
  matchKey?: string;
  matchNumber: number;
  matchType: 'qualification' | 'playoff' | 'practice';
  teamNumber: number;
  difficulty: 'easy' | 'medium' | 'hard';
  scoutedData: {
    teamNumber: string;
    startingPosition: string;
    leftStartingZone: boolean;
    autoCoralMissed: number;
    autoCoralL1: number;
    autoCoralL2: number;
    autoCoralL3: number;
    autoCoralL4: number;
    autoAlgaeProcessorMissed: number;
    autoAlgaeProcessorScored: number;
    autoAlgaeNetMissed: number;
    autoAlgaeNetScored: number;
    teleopCoralMissed: number;
    teleopCoralL1: number;
    teleopCoralL2: number;
    teleopCoralL3: number;
    teleopCoralL4: number;
    teleopAlgaeRemoved: boolean;
    teleopProcessorMissed: number;
    teleopProcessorScored: number;
    teleopNetRobotMissed: number;
    teleopNetRobotScored: number;
    teleopNetHumanMissed: number;
    teleopNetHumanScored: number;
    failedClimb: number;
    stageStatus: string;
    incidents: string[];
    notes: string;
  };
  actualData: {
    teamNumber: string;
    startingPosition: string;
    leftStartingZone: boolean;
    autoCoralMissed: number;
    autoCoralL1: number;
    autoCoralL2: number;
    autoCoralL3: number;
    autoCoralL4: number;
    autoAlgaeProcessorMissed: number;
    autoAlgaeProcessorScored: number;
    autoAlgaeNetMissed: number;
    autoAlgaeNetScored: number;
    teleopCoralMissed: number;
    teleopCoralL1: number;
    teleopCoralL2: number;
    teleopCoralL3: number;
    teleopCoralL4: number;
    teleopAlgaeRemoved: boolean;
    teleopProcessorMissed: number;
    teleopProcessorScored: number;
    teleopNetRobotMissed: number;
    teleopNetRobotScored: number;
    teleopNetHumanMissed: number;
    teleopNetHumanScored: number;
    failedClimb: number;
    stageStatus: string;
    incidents: string[];
    notes: string;
  };
  scoutedScore: number;
  actualScore: number;
  accuracy: number;
  timestamp: number;
  startedAt?: number;
  completedAt?: number;
}

// ==========================================
// HELPER FUNCTIONS
// ==========================================

const SCORING_POINTS = {
  LEAVE: 3,
  AUTO_CORAL_L1: 3,
  AUTO_CORAL_L2: 4,
  AUTO_CORAL_L3: 6,
  AUTO_CORAL_L4: 7,
  AUTO_ALGAE_PROC: 6,
  AUTO_ALGAE_NET: 4,
  TELE_CORAL_L1: 2,
  TELE_CORAL_L2: 3,
  TELE_CORAL_L3: 4,
  TELE_CORAL_L4: 5,
  TELE_ALGAE_PROC: 6,
  TELE_ALGAE_NET_R: 4,
  TELE_ALGAE_NET_H: 4,
  CLIMB_PARK: 2,
  CLIMB_SHALLOW: 6,
  CLIMB_DEEP: 12,
  ALGAE_REMOVED: 2,
};

function calculateScoutedScore(data: PracticeSession['scoutedData']): number {
  let score = 0;
  
  if (data.leftStartingZone) score += SCORING_POINTS.LEAVE;
  
  score += data.autoCoralL1 * SCORING_POINTS.AUTO_CORAL_L1;
  score += data.autoCoralL2 * SCORING_POINTS.AUTO_CORAL_L2;
  score += data.autoCoralL3 * SCORING_POINTS.AUTO_CORAL_L3;
  score += data.autoCoralL4 * SCORING_POINTS.AUTO_CORAL_L4;
  score += data.autoAlgaeProcessorScored * SCORING_POINTS.AUTO_ALGAE_PROC;
  score += data.autoAlgaeNetScored * SCORING_POINTS.AUTO_ALGAE_NET;
  
  score += data.teleopCoralL1 * SCORING_POINTS.TELE_CORAL_L1;
  score += data.teleopCoralL2 * SCORING_POINTS.TELE_CORAL_L2;
  score += data.teleopCoralL3 * SCORING_POINTS.TELE_CORAL_L3;
  score += data.teleopCoralL4 * SCORING_POINTS.TELE_CORAL_L4;
  score += data.teleopProcessorScored * SCORING_POINTS.TELE_ALGAE_PROC;
  score += data.teleopNetRobotScored * SCORING_POINTS.TELE_ALGAE_NET_R;
  score += data.teleopNetHumanScored * SCORING_POINTS.TELE_ALGAE_NET_H;
  
  if (data.teleopAlgaeRemoved) score += SCORING_POINTS.ALGAE_REMOVED;
  
  const endStatus = data.stageStatus.toLowerCase();
  if (endStatus.includes('deep')) score += SCORING_POINTS.CLIMB_DEEP;
  else if (endStatus.includes('shallow')) score += SCORING_POINTS.CLIMB_SHALLOW;
  else if (endStatus.includes('park') || endStatus.includes('barge')) {
    score += SCORING_POINTS.CLIMB_PARK;
  }
  
  return score;
}

function calculateAccuracy(
  scoutedData: PracticeSession['scoutedData'],
  actualData: PracticeSession['actualData']
): number {
  let totalFields = 0;
  let correctFields = 0;
  
  const numericFields: (keyof typeof scoutedData)[] = [
    'autoCoralMissed', 'autoCoralL1', 'autoCoralL2', 'autoCoralL3', 'autoCoralL4',
    'autoAlgaeProcessorMissed', 'autoAlgaeProcessorScored',
    'autoAlgaeNetMissed', 'autoAlgaeNetScored',
    'teleopCoralMissed', 'teleopCoralL1', 'teleopCoralL2', 'teleopCoralL3', 'teleopCoralL4',
    'teleopProcessorMissed', 'teleopProcessorScored',
    'teleopNetRobotMissed', 'teleopNetRobotScored',
    'teleopNetHumanMissed', 'teleopNetHumanScored',
    'failedClimb'
  ];
  
  numericFields.forEach(field => {
    totalFields++;
    const scouted = scoutedData[field] as number;
    const actual = actualData[field] as number;
    
    if (Math.abs(scouted - actual) <= 1) {
      correctFields++;
    }
  });
  
  if (scoutedData.leftStartingZone === actualData.leftStartingZone) correctFields++;
  totalFields++;
  
  if (scoutedData.teleopAlgaeRemoved === actualData.teleopAlgaeRemoved) correctFields++;
  totalFields++;
  
  if (scoutedData.startingPosition === actualData.startingPosition) correctFields++;
  totalFields++;
  
  if (scoutedData.stageStatus === actualData.stageStatus) correctFields++;
  totalFields++;
  
  return Math.round((correctFields / totalFields) * 100);
}

// ==========================================
// COUNTER COMPONENT
// ==========================================

const Counter = ({ label, value, onChange }: { label: string; value: number; onChange: (val: number) => void }) => (
  <div className="flex items-center justify-between py-2">
    <span className="text-sm font-medium text-gray-700">{label}</span>
    <div className="flex items-center gap-2">
      <button onClick={() => onChange(Math.max(0, value - 1))} className="w-8 h-8 rounded bg-gray-200 hover:bg-gray-300 font-semibold">−</button>
      <span className="w-8 text-center font-semibold">{value}</span>
      <button onClick={() => onChange(value + 1)} className="w-8 h-8 rounded bg-gray-200 hover:bg-gray-300 font-semibold">+</button>
    </div>
  </div>
);

// ==========================================
// MAIN COMPONENT
// ==========================================

function PracticeScoutingContent() {
  const router = useRouter();
  const { userData } = useAuth();
  const [currentStep, setCurrentStep] = useState<'select' | 'practice' | 'results'>('select');
  const [selectedDifficulty, setSelectedDifficulty] = useState<'easy' | 'medium' | 'hard' | null>(null);
  const [currentMatch, setCurrentMatch] = useState<PracticeMatch | null>(null);
  const [sessionResults, setSessionResults] = useState<PracticeSession | null>(null);
  const [loading, setLoading] = useState(false);

  const [formData, setFormData] = useState({
    teamNumber: "",
    startingPosition: "",
    leftStartingZone: false,
    autoCoralMissed: 0,
    autoCoralL1: 0,
    autoCoralL2: 0,
    autoCoralL3: 0,
    autoCoralL4: 0,
    autoAlgaeProcessorMissed: 0,
    autoAlgaeProcessorScored: 0,
    autoAlgaeNetMissed: 0,
    autoAlgaeNetScored: 0,
    teleopCoralMissed: 0,
    teleopCoralL1: 0,
    teleopCoralL2: 0,
    teleopCoralL3: 0,
    teleopCoralL4: 0,
    teleopAlgaeRemoved: false,
    teleopProcessorMissed: 0,
    teleopProcessorScored: 0,
    teleopNetRobotMissed: 0,
    teleopNetRobotScored: 0,
    teleopNetHumanMissed: 0,
    teleopNetHumanScored: 0,
    failedClimb: 0,
    stageStatus: "",
    incidents: [] as string[],
    notes: "",
  });

  async function selectPracticeMatch(difficulty: 'easy' | 'medium' | 'hard') {
    setLoading(true);
    setSelectedDifficulty(difficulty);

    try {
      const matchesQuery = query(
        collection(db, 'practiceMatches'),
        where('difficulty', '==', difficulty)
      );
      const matchesSnapshot = await getDocs(matchesQuery);
      const matches = matchesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as PracticeMatch[];

      if (matches.length === 0) {
        alert('No practice matches available for this difficulty. Please try another level.');
        setLoading(false);
        return;
      }

      const randomMatch = matches[Math.floor(Math.random() * matches.length)];
      setCurrentMatch(randomMatch);
      setFormData(prev => ({ ...prev, teamNumber: randomMatch.teamNumber.toString() }));
      setCurrentStep('practice');
    } catch (error) {
      console.error('Error loading practice match:', error);
      alert('Error loading practice match. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function submitPracticeSession() {
    if (!currentMatch || !userData) return;

    const scoutedScore = calculateScoutedScore(formData);
    const actualScore = currentMatch.actualScore;
    const accuracy = calculateAccuracy(formData, currentMatch.actualData);

    const session: PracticeSession = {
      scoutName: userData.displayName || 'Unknown',
      scoutId: userData.uid,
      matchKey: currentMatch.matchKey,
      matchNumber: currentMatch.matchNumber,
      matchType: currentMatch.matchType,
      teamNumber: currentMatch.teamNumber,
      difficulty: currentMatch.difficulty,
      scoutedData: formData,
      actualData: currentMatch.actualData,
      scoutedScore,
      actualScore,
      accuracy,
      timestamp: Date.now(),
      startedAt: Date.now(),
      completedAt: Date.now(),
    };

    try {
      const docRef = await addDoc(collection(db, 'practiceSessions'), session);
      setSessionResults({ ...session, id: docRef.id });
      setCurrentStep('results');
    } catch (error) {
      console.error('Error saving practice session:', error);
      alert('Error saving practice session.');
    }
  }

  function resetPractice() {
    setCurrentStep('select');
    setSelectedDifficulty(null);
    setCurrentMatch(null);
    setSessionResults(null);
    setFormData({
      teamNumber: "",
      startingPosition: "",
      leftStartingZone: false,
      autoCoralMissed: 0,
      autoCoralL1: 0,
      autoCoralL2: 0,
      autoCoralL3: 0,
      autoCoralL4: 0,
      autoAlgaeProcessorMissed: 0,
      autoAlgaeProcessorScored: 0,
      autoAlgaeNetMissed: 0,
      autoAlgaeNetScored: 0,
      teleopCoralMissed: 0,
      teleopCoralL1: 0,
      teleopCoralL2: 0,
      teleopCoralL3: 0,
      teleopCoralL4: 0,
      teleopAlgaeRemoved: false,
      teleopProcessorMissed: 0,
      teleopProcessorScored: 0,
      teleopNetRobotMissed: 0,
      teleopNetRobotScored: 0,
      teleopNetHumanMissed: 0,
      teleopNetHumanScored: 0,
      failedClimb: 0,
      stageStatus: "",
      incidents: [],
      notes: "",
    });
  }

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        {currentStep === 'select' && (
          <div className="p-8 max-w-4xl mx-auto">
            <h1 className="text-3xl font-bold mb-2" style={{ color: "#c42221" }}>Practice Scouting</h1>
            <p className="text-gray-600 mb-8">Improve your accuracy by practicing with real match footage.</p>

            <div className="bg-white rounded-xl shadow-md p-8 mb-6">
              <h2 className="text-2xl font-semibold mb-4">How Practice Works</h2>
              <div className="space-y-4">
                <div className="flex gap-4">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold shrink-0" style={{ backgroundColor: "#c42221" }}>1</div>
                  <div>
                    <h3 className="font-semibold mb-1">Watch a Recorded Match</h3>
                    <p className="text-gray-600">We'll show you a pre-recorded match video from a real competition.</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold shrink-0" style={{ backgroundColor: "#c42221" }}>2</div>
                  <div>
                    <h3 className="font-semibold mb-1">Scout the Robot</h3>
                    <p className="text-gray-600">Fill out the scouting form just like a real match. The video can't be paused!</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold shrink-0" style={{ backgroundColor: "#c42221" }}>3</div>
                  <div>
                    <h3 className="font-semibold mb-1">Get Your Score</h3>
                    <p className="text-gray-600">We'll compare your data to the verified official results and give you an accuracy percentage.</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-md p-8">
              <h2 className="text-2xl font-semibold mb-4">Select Difficulty</h2>
              <div className="grid md:grid-cols-3 gap-4">
                <button onClick={() => selectPracticeMatch('easy')} disabled={loading} className="p-6 border-2 border-green-300 rounded-lg hover:bg-green-50 text-left transition-colors disabled:opacity-50">
                  <div className="text-3xl mb-2">🟢</div>
                  <h3 className="font-semibold text-lg mb-1">Easy</h3>
                  <p className="text-sm text-gray-600">Alliance score: 0-100 points</p>
                  <p className="text-xs text-gray-500 mt-2">Good for beginners</p>
                </button>

                <button onClick={() => selectPracticeMatch('medium')} disabled={loading} className="p-6 border-2 border-yellow-300 rounded-lg hover:bg-yellow-50 text-left transition-colors disabled:opacity-50">
                  <div className="text-3xl mb-2">🟡</div>
                  <h3 className="font-semibold text-lg mb-1">Medium</h3>
                  <p className="text-sm text-gray-600">Alliance score: 101-200 points</p>
                  <p className="text-xs text-gray-500 mt-2">Moderate challenge</p>
                </button>

                <button onClick={() => selectPracticeMatch('hard')} disabled={loading} className="p-6 border-2 border-red-300 rounded-lg hover:bg-red-50 text-left transition-colors disabled:opacity-50">
                  <div className="text-3xl mb-2">🔴</div>
                  <h3 className="font-semibold text-lg mb-1">Hard</h3>
                  <p className="text-sm text-gray-600">Alliance score: 201-300 points</p>
                  <p className="text-xs text-gray-500 mt-2">Advanced scouts only</p>
                </button>
              </div>
            </div>
          </div>
        )}

        {currentStep === 'practice' && currentMatch && (
          <div className="min-h-screen bg-gray-100 p-8">
            <div className="max-w-4xl mx-auto">
              <div className="bg-white rounded-xl shadow-md p-8 text-center">
                <h2 className="text-2xl font-bold mb-4" style={{ color: "#c42221" }}>Practice Match {currentMatch.matchNumber}</h2>
                <p className="text-gray-600 mb-4">Scout Team {currentMatch.teamNumber} - {currentMatch.alliance} Alliance</p>
                <p className="text-sm text-yellow-600 mb-6">⚠️ This is a placeholder. Add your video player and form here.</p>
                
                <div className="space-y-3">
                  <button onClick={submitPracticeSession} className="w-full py-3 rounded text-white font-semibold" style={{ backgroundColor: "#c42221" }}>
                    Submit Practice Session
                  </button>
                  <button onClick={resetPractice} className="w-full py-2 rounded border-2 border-gray-300 text-gray-700 font-medium hover:bg-gray-50">
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {currentStep === 'results' && sessionResults && (
          <div className="p-8 max-w-4xl mx-auto">
            <div className="bg-white rounded-xl shadow-md p-8 mb-6 text-center">
              <div className="text-6xl mb-4">
                {sessionResults.accuracy >= 90 ? "🎉" : sessionResults.accuracy >= 75 ? "👍" : "📚"}
              </div>
              <h1 className="text-3xl font-bold mb-2" style={{ color: "#c42221" }}>
                Practice Session Complete!
              </h1>
              <p className="text-gray-600 mb-6">Here's how you did:</p>

              <div className="grid md:grid-cols-3 gap-6 mb-8">
                <div className="p-6 bg-gray-50 rounded-lg">
                  <h3 className="text-sm font-medium text-gray-600 mb-2">Your Score</h3>
                  <p className="text-4xl font-bold" style={{ color: "#c42221" }}>{sessionResults.scoutedScore}</p>
                  <p className="text-xs text-gray-500 mt-1">points</p>
                </div>

                <div className="p-6 bg-gray-50 rounded-lg">
                  <h3 className="text-sm font-medium text-gray-600 mb-2">Actual Score</h3>
                  <p className="text-4xl font-bold text-gray-700">{sessionResults.actualScore}</p>
                  <p className="text-xs text-gray-500 mt-1">points</p>
                </div>

                <div className="p-6 bg-gradient-to-br from-green-50 to-green-100 rounded-lg">
                  <h3 className="text-sm font-medium text-green-700 mb-2">Accuracy</h3>
                  <p className="text-4xl font-bold text-green-600">{sessionResults.accuracy}%</p>
                  <p className="text-xs text-green-600 mt-1">
                    {sessionResults.accuracy >= 90 ? "Excellent!" : sessionResults.accuracy >= 75 ? "Good job!" : "Keep practicing!"}
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <button onClick={resetPractice} className="w-full py-3 rounded text-white font-semibold" style={{ backgroundColor: "#c42221" }}>
                  Do Another Practice Session
                </button>
                <button onClick={() => router.push('/dashboard/scout')} className="w-full py-2 rounded border-2 text-gray-700 font-medium hover:bg-gray-50" style={{ borderColor: "#c42221" }}>
                  Return to Dashboard
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ==========================================
// DEFAULT EXPORT (REQUIRED!)
// ==========================================

export default function PracticeScoutingPage() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["coach", "scout"]}>
      <PracticeScoutingContent />
    </ProtectedRoute>
  );
}

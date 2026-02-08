"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { collection, addDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";
import { PracticeMatch, PracticeSession, calculateScoutedScore, calculateAccuracy } from "@/app/utils/practiceTypes";

// Counter component (reused from scout form)
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

function PracticeScoutingContent() {
  const router = useRouter();
  const { userData } = useAuth();
  const [currentStep, setCurrentStep] = useState<'select' | 'practice' | 'results'>('select');
  const [selectedDifficulty, setSelectedDifficulty] = useState<'easy' | 'medium' | 'hard' | null>(null);
  const [currentMatch, setCurrentMatch] = useState<PracticeMatch | null>(null);
  const [sessionResults, setSessionResults] = useState<PracticeSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);

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
      // Fetch available practice matches from Firebase
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

      // Select random match
      const randomMatch = matches[Math.floor(Math.random() * matches.length)];
      setCurrentMatch(randomMatch);

      // Pre-fill team number
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
    const officialScore = currentMatch.officialData.score;
    const accuracy = calculateAccuracy(scoutedScore, officialScore);

    const session: Omit<PracticeSession, 'id'> = {
      scoutName: userData.displayName,
      scoutId: userData.uid,
      matchKey: currentMatch.matchKey,
      matchNumber: currentMatch.matchNumber,
      teamNumber: currentMatch.teamNumber,
      difficulty: currentMatch.difficulty,
      scoutedData: formData,
      scoutedScore,
      officialScore,
      accuracy,
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
        {/* STEP 1: DIFFICULTY SELECTION */}
        {currentStep === 'select' && (
          <div className="p-8 max-w-4xl mx-auto">
            <h1 className="text-3xl font-bold mb-2" style={{ color: "#c42221" }}>
              Practice Scouting
            </h1>
            <p className="text-gray-600 mb-8">
              Improve your accuracy by practicing with real match footage.
            </p>

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
                <button
                  onClick={() => selectPracticeMatch('easy')}
                  disabled={loading}
                  className="p-6 border-2 border-green-300 rounded-lg hover:bg-green-50 text-left transition-colors disabled:opacity-50"
                >
                  <div className="text-3xl mb-2">🟢</div>
                  <h3 className="font-semibold text-lg mb-1">Easy</h3>
                  <p className="text-sm text-gray-600">Alliance score: 0-100 points</p>
                  <p className="text-xs text-gray-500 mt-2">Good for beginners</p>
                </button>

                <button
                  onClick={() => selectPracticeMatch('medium')}
                  disabled={loading}
                  className="p-6 border-2 border-yellow-300 rounded-lg hover:bg-yellow-50 text-left transition-colors disabled:opacity-50"
                >
                  <div className="text-3xl mb-2">🟡</div>
                  <h3 className="font-semibold text-lg mb-1">Medium</h3>
                  <p className="text-sm text-gray-600">Alliance score: 101-200 points</p>
                  <p className="text-xs text-gray-500 mt-2">Moderate challenge</p>
                </button>

                <button
                  onClick={() => selectPracticeMatch('hard')}
                  disabled={loading}
                  className="p-6 border-2 border-red-300 rounded-lg hover:bg-red-50 text-left transition-colors disabled:opacity-50"
                >
                  <div className="text-3xl mb-2">🔴</div>
                  <h3 className="font-semibold text-lg mb-1">Hard</h3>
                  <p className="text-sm text-gray-600">Alliance score: 201-300 points</p>
                  <p className="text-xs text-gray-500 mt-2">Advanced scouts only</p>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STEP 2: PRACTICE SCOUTING */}
        {currentStep === 'practice' && currentMatch && (
          <div className="h-screen flex flex-col md:flex-row">
            {/* VIDEO PLAYER (LEFT SIDE - 60%) */}
            <div className="md:w-[60%] bg-black flex items-center justify-center relative">
              <div className="w-full aspect-video">
                <iframe
                  src={`${currentMatch.videoUrl}?autoplay=1&controls=0&disablekb=1&modestbranding=1&rel=0`}
                  className="w-full h-full"
                  allow="autoplay; fullscreen"
                  allowFullScreen
                  title="Practice Match Video"
                />
                {/* Overlay to prevent interactions */}
                <div className="absolute inset-0 pointer-events-none bg-transparent" />
              </div>

              {/* Match Info Overlay */}
              <div className="absolute top-4 left-4 bg-black bg-opacity-75 text-white p-4 rounded-lg">
                <h3 className="font-semibold text-lg">Practice Match {currentMatch.matchNumber}</h3>
                <p className="text-sm">Scout Team {currentMatch.teamNumber}</p>
                <p className="text-sm capitalize">{currentMatch.alliance} Alliance • Position {currentMatch.teamPosition + 1}</p>
                <p className="text-xs mt-2 text-yellow-300">⚠️ Video cannot be paused</p>
              </div>
            </div>

            {/* SCOUTING FORM (RIGHT SIDE - 40%) */}
            <div className="md:w-[40%] overflow-y-auto bg-gray-100 p-4 space-y-4">
              {/* PRE-MATCH */}
              <div className="bg-white rounded-xl shadow p-4">
                <h2 className="text-lg font-semibold mb-4" style={{ color: "#c42221" }}>Pre-Match Info</h2>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Team Number</label>
                    <input type="text" value={formData.teamNumber} disabled className="w-full border rounded p-2 bg-gray-100" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Starting Position</label>
                    <select value={formData.startingPosition} onChange={(e) => setFormData({ ...formData, startingPosition: e.target.value })} className="w-full border rounded p-2">
                      <option value="">Select Position</option>
                      <option value="Not There">Not There</option>
                      <option value="Processor Side">Processor Side</option>
                      <option value="Middle">Middle</option>
                      <option value="Opposite Side">Opposite Side</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* AUTONOMOUS */}
              <div className="bg-white rounded-xl shadow p-4">
                <h2 className="text-lg font-semibold mb-4" style={{ color: "#c42221" }}>Autonomous</h2>
                <label className="flex items-center gap-2 cursor-pointer mb-3">
                  <input type="checkbox" checked={formData.leftStartingZone} onChange={(e) => setFormData({ ...formData, leftStartingZone: e.target.checked })} className="w-4 h-4" />
                  <span className="text-sm font-medium text-gray-700">Left Starting Zone</span>
                </label>
                <div className="border-t pt-3">
                  <h3 className="font-semibold text-base mb-2">Auto Coral</h3>
                  <Counter label="Missed" value={formData.autoCoralMissed} onChange={(val) => setFormData({ ...formData, autoCoralMissed: val })} />
                  <Counter label="Level 1" value={formData.autoCoralL1} onChange={(val) => setFormData({ ...formData, autoCoralL1: val })} />
                  <Counter label="Level 2" value={formData.autoCoralL2} onChange={(val) => setFormData({ ...formData, autoCoralL2: val })} />
                  <Counter label="Level 3" value={formData.autoCoralL3} onChange={(val) => setFormData({ ...formData, autoCoralL3: val })} />
                  <Counter label="Level 4" value={formData.autoCoralL4} onChange={(val) => setFormData({ ...formData, autoCoralL4: val })} />
                </div>
                <div className="border-t pt-3 mt-3">
                  <h3 className="font-semibold text-base mb-2">Auto Algae Processor</h3>
                  <Counter label="Missed" value={formData.autoAlgaeProcessorMissed} onChange={(val) => setFormData({ ...formData, autoAlgaeProcessorMissed: val })} />
                  <Counter label="Scored" value={formData.autoAlgaeProcessorScored} onChange={(val) => setFormData({ ...formData, autoAlgaeProcessorScored: val })} />
                </div>
                <div className="border-t pt-3 mt-3">
                  <h3 className="font-semibold text-base mb-2">Auto Algae Net</h3>
                  <Counter label="Missed" value={formData.autoAlgaeNetMissed} onChange={(val) => setFormData({ ...formData, autoAlgaeNetMissed: val })} />
                  <Counter label="Scored" value={formData.autoAlgaeNetScored} onChange={(val) => setFormData({ ...formData, autoAlgaeNetScored: val })} />
                </div>
              </div>

              {/* TELEOP */}
              <div className="bg-white rounded-xl shadow p-4">
                <h2 className="text-lg font-semibold mb-4" style={{ color: "#c42221" }}>Teleop</h2>
                <div className="border-b pb-3">
                  <h3 className="font-semibold text-base mb-2">Teleop Coral</h3>
                  <Counter label="Missed" value={formData.teleopCoralMissed} onChange={(val) => setFormData({ ...formData, teleopCoralMissed: val })} />
                  <Counter label="Level 1" value={formData.teleopCoralL1} onChange={(val) => setFormData({ ...formData, teleopCoralL1: val })} />
                  <Counter label="Level 2" value={formData.teleopCoralL2} onChange={(val) => setFormData({ ...formData, teleopCoralL2: val })} />
                  <Counter label="Level 3" value={formData.teleopCoralL3} onChange={(val) => setFormData({ ...formData, teleopCoralL3: val })} />
                  <Counter label="Level 4" value={formData.teleopCoralL4} onChange={(val) => setFormData({ ...formData, teleopCoralL4: val })} />
                </div>
                <label className="flex items-center gap-2 cursor-pointer my-3">
                  <input type="checkbox" checked={formData.teleopAlgaeRemoved} onChange={(e) => setFormData({ ...formData, teleopAlgaeRemoved: e.target.checked })} className="w-4 h-4" />
                  <span className="text-sm font-medium text-gray-700">Removed Algae from Reef</span>
                </label>
                <div className="border-t pt-3">
                  <h3 className="font-semibold text-base mb-2">Teleop Processor</h3>
                  <Counter label="Missed" value={formData.teleopProcessorMissed} onChange={(val) => setFormData({ ...formData, teleopProcessorMissed: val })} />
                  <Counter label="Scored" value={formData.teleopProcessorScored} onChange={(val) => setFormData({ ...formData, teleopProcessorScored: val })} />
                </div>
                <div className="border-t pt-3 mt-3">
                  <h3 className="font-semibold text-base mb-2">Teleop Algae Net – Robot</h3>
                  <Counter label="Missed" value={formData.teleopNetRobotMissed} onChange={(val) => setFormData({ ...formData, teleopNetRobotMissed: val })} />
                  <Counter label="Scored" value={formData.teleopNetRobotScored} onChange={(val) => setFormData({ ...formData, teleopNetRobotScored: val })} />
                </div>
                <div className="border-t pt-3 mt-3">
                  <h3 className="font-semibold text-base mb-2">Teleop Algae Net – Human</h3>
                  <Counter label="Missed" value={formData.teleopNetHumanMissed} onChange={(val) => setFormData({ ...formData, teleopNetHumanMissed: val })} />
                  <Counter label="Scored" value={formData.teleopNetHumanScored} onChange={(val) => setFormData({ ...formData, teleopNetHumanScored: val })} />
                </div>
              </div>

              {/* ENDGAME */}
              <div className="bg-white rounded-xl shadow p-4">
                <h2 className="text-lg font-semibold mb-4" style={{ color: "#c42221" }}>Endgame</h2>
                <Counter label="Failed Climb" value={formData.failedClimb} onChange={(val) => setFormData({ ...formData, failedClimb: val })} />
                <div className="mt-3">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Stage Status</label>
                  <select value={formData.stageStatus} onChange={(e) => setFormData({ ...formData, stageStatus: e.target.value })} className="w-full border rounded p-2">
                    <option value="">Select Status</option>
                    <option value="Not Parked">Not Parked</option>
                    <option value="Parked in Barge Zone">Parked in Barge Zone</option>
                    <option value="Shallow Cage">Shallow Cage</option>
                    <option value="Deep Cage">Deep Cage</option>
                  </select>
                </div>
              </div>

              {/* GENERAL */}
              <div className="bg-white rounded-xl shadow p-4">
                <h2 className="text-lg font-semibold mb-4" style={{ color: "#c42221" }}>General</h2>
                <div className="space-y-2">
                  {[
                    { value: "died", label: "Died During Match" },
                    { value: "never-started", label: "Never Started Match" },
                    { value: "disabled", label: "Disabled by FRC" },
                    { value: "recovered", label: "Recovered from Freeze" },
                    { value: "tipped", label: "Tipped Over" },
                    { value: "yellow-card", label: "Yellow Card" },
                    { value: "red-card", label: "Red Card" },
                  ].map((incident) => (
                    <label key={incident.value} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.incidents.includes(incident.value)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setFormData({ ...formData, incidents: [...formData.incidents, incident.value] });
                          } else {
                            setFormData({ ...formData, incidents: formData.incidents.filter(i => i !== incident.value) });
                          }
                        }}
                        className="w-4 h-4"
                      />
                      <span className="text-sm text-gray-700">{incident.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* NOTES */}
              <div className="bg-white rounded-xl shadow p-4">
                <h2 className="text-lg font-semibold mb-2" style={{ color: "#c42221" }}>Notes</h2>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="w-full border rounded p-2 h-24 resize-none"
                  placeholder="Optional notes..."
                />
              </div>

              {/* SUBMIT */}
              <div className="bg-white rounded-xl shadow p-4">
                <button
                  onClick={submitPracticeSession}
                  className="w-full py-3 rounded text-white font-semibold mb-2"
                  style={{ backgroundColor: "#c42221" }}
                >
                  Submit Practice Session
                </button>
                <button
                  onClick={resetPractice}
                  className="w-full py-2 rounded border-2 border-gray-300 text-gray-700 font-medium hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STEP 3: RESULTS */}
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
                  <h3 className="text-sm font-medium text-gray-600 mb-2">Official Score</h3>
                  <p className="text-4xl font-bold text-gray-700">{sessionResults.officialScore}</p>
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
                <button
                  onClick={resetPractice}
                  className="w-full py-3 rounded text-white font-semibold"
                  style={{ backgroundColor: "#c42221" }}
                >
                  Do Another Practice Session
                </button>
                <button
                  onClick={() => router.push('/dashboard/scout')}
                  className="w-full py-2 rounded border-2 text-gray-700 font-medium hover:bg-gray-50"
                  style={{ borderColor: "#c42221" }}
                >
                  Return to Dashboard
                </button>
              </div>
            </div>

            <div className="bg-blue-50 border-l-4 border-blue-500 p-4 rounded">
              <p className="text-sm text-blue-700">
                <strong>💡 Tip:</strong> {sessionResults.accuracy >= 90 
                  ? "You're ready for competition scouting! Your accuracy is excellent."
                  : "Try practicing a few more times to improve your accuracy before competition matches."
                }
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function PracticeScoutingPage() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["coach", "scout"]}>
      <PracticeScoutingContent />
    </ProtectedRoute>
  );
}

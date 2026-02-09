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
  const [currentStep, setCurrentStep] = useState<'select' | 'practice' | 'robot-complete' | 'results'>('select');
  const [selectedDifficulty, setSelectedDifficulty] = useState<'easy' | 'medium' | 'hard' | null>(null);
  const [currentMatch, setCurrentMatch] = useState<PracticeMatch | null>(null);
  const [sessionResults, setSessionResults] = useState<PracticeSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  
  // Track robot progress (3 robots per alliance)
  const [robotsCompleted, setRobotsCompleted] = useState(0);
  const [allRobotData, setAllRobotData] = useState<any[]>([]);
  const [currentRobotPosition, setCurrentRobotPosition] = useState<1 | 2 | 3>(1); // Which of the 3 robots to scout

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

  // Get match type from match number (Q = Qualification, F = Finals)
  function getMatchType(matchNumber: number): string {
    // In FRC: matches 1-N are qualifications, then playoffs/finals
    // For practice, we'll check if match number > 100 for finals
    return matchNumber > 100 ? "Finals" : "Qualification";
  }

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
      setRobotsCompleted(0);
      setAllRobotData([]);
      
      // Randomly select which robot position to scout (1, 2, or 3)
      setCurrentRobotPosition((Math.floor(Math.random() * 3) + 1) as 1 | 2 | 3);
    } catch (error) {
      console.error('Error loading practice match:', error);
      alert('Error loading practice match. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function submitRobotData() {
    if (!currentMatch || !userData) return;

    // Save current robot data
    const robotData = {
      ...formData,
      robotNumber: robotsCompleted + 1,
      timestamp: Date.now()
    };

    setAllRobotData(prev => [...prev, robotData]);
    
    const newCount = robotsCompleted + 1;
    setRobotsCompleted(newCount);

    // Check if all 3 robots are done
    if (newCount >= 3) {
      // Calculate session results based on all 3 robots
      await completePracticeSession();
    } else {
      // Move to robot-complete screen
      setCurrentStep('robot-complete');
    }
  }

  async function completePracticeSession() {
    if (!currentMatch || !userData || allRobotData.length < 3) return;

    try {
      // Calculate average score across all 3 robots
      let totalScoutedScore = 0;
      allRobotData.forEach(robotData => {
        totalScoutedScore += calculateScoutedScore(robotData);
      });
      const avgScoutedScore = Math.round(totalScoutedScore / 3);

      const officialScore = currentMatch.officialData.score;
      const accuracy = calculateAccuracy(avgScoutedScore, officialScore);

      const session: Omit<PracticeSession, 'id'> = {
        scoutName: userData.displayName,
        scoutId: userData.uid,
        matchKey: currentMatch.matchKey,
        matchNumber: currentMatch.matchNumber,
        teamNumber: currentMatch.teamNumber,
        difficulty: currentMatch.difficulty,
        scoutedData: allRobotData[0], // Use first robot for reference
        scoutedScore: avgScoutedScore,
        officialScore: officialScore,
        accuracy: accuracy,
        startedAt: Date.now() - 180000, // Approximate
        completedAt: Date.now(),
      };

      const docRef = await addDoc(collection(db, 'practiceSessions'), session);

      setSessionResults({ id: docRef.id, ...session });
      setCurrentStep('results');
    } catch (error) {
      console.error('Error saving practice session:', error);
      alert('Error saving practice session. Please try again.');
    }
  }

  function continueToNextRobot() {
    // Reset form for next robot
    setFormData({
      teamNumber: currentMatch?.teamNumber.toString() || "",
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
    
    // Pick a new random robot position for next robot
    setCurrentRobotPosition((Math.floor(Math.random() * 3) + 1) as 1 | 2 | 3);
    
    setCurrentStep('practice');
  }

  function resetPractice() {
    setCurrentStep('select');
    setCurrentMatch(null);
    setSessionResults(null);
    setSelectedDifficulty(null);
    setRobotsCompleted(0);
    setAllRobotData([]);
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
    <ProtectedRoute allowedRoles={["scout", "coach"]}>
      <div className="flex min-h-screen bg-gray-100">
        <Sidebar />
        
        {/* STEP 1: SELECT DIFFICULTY */}
        {currentStep === 'select' && (
          <div className="flex-1 p-8">
            <h1 className="text-3xl font-bold mb-6" style={{ color: "#c42221" }}>Practice Scouting</h1>
            
            <div className="bg-blue-50 border-l-4 border-blue-400 p-6 mb-6 rounded">
              <h2 className="font-semibold text-lg mb-3 text-blue-900">How Practice Scouting Works</h2>
              <div className="space-y-4">
                <div className="flex gap-4">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold shrink-0" style={{ backgroundColor: "#c42221" }}>1</div>
                  <div>
                    <h3 className="font-semibold mb-1">Watch Real Match Footage</h3>
                    <p className="text-gray-600">Scout all 3 robots on your alliance from actual FRC matches. Video cannot be paused.</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold shrink-0" style={{ backgroundColor: "#c42221" }}>2</div>
                  <div>
                    <h3 className="font-semibold mb-1">Fill Out the Scouting Form</h3>
                    <p className="text-gray-600">Track each robot's performance using the same form you'll use at competition.</p>
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
              <p className="text-gray-600 mb-6">All matches require scouting all 3 alliance robots to complete a session.</p>
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
          <div className="flex-1 h-screen flex flex-col md:flex-row">
            {/* VIDEO PLAYER (LEFT SIDE - 65%) */}
            <div className="md:w-[65%] bg-black flex items-center justify-center relative">
              <div className="w-full h-full flex items-center justify-center">
                <div className="relative w-full h-full">
                  <iframe
                    src={`https://www.youtube.com/embed/${currentMatch.videoUrl.split('v=')[1]?.split('&')[0]}?autoplay=1&controls=0&disablekb=1&modestbranding=1&rel=0&showinfo=0&fs=0&iv_load_policy=3`}
                    className="w-full h-full"
                    allow="autoplay"
                    title="Practice Match Video"
                    style={{ pointerEvents: 'none' }}
                  />
                  {/* Overlay to block ALL interactions */}
                  <div className="absolute inset-0" style={{ pointerEvents: 'auto', background: 'transparent' }} />
                </div>
              </div>

              {/* Match Info Overlay */}
              <div className="absolute top-4 left-4 bg-black bg-opacity-75 text-white p-4 rounded-lg">
                <h3 className="font-semibold text-lg">{getMatchType(currentMatch.matchNumber)} {currentMatch.matchNumber}</h3>
                <p className="text-sm">Scout Team {currentMatch.teamNumber}</p>
                <p className="text-sm capitalize">{currentMatch.alliance} Alliance - Robot #{currentRobotPosition}</p>
                <p className="text-sm text-gray-300">Session: Robot {robotsCompleted + 1}/3</p>
                <p className="text-xs mt-2 text-yellow-300">⚠️ Video cannot be paused</p>
              </div>
            </div>

            {/* SCOUTING FORM (RIGHT SIDE - 35%) */}
            <div className="md:w-[35%] overflow-y-auto bg-gray-100 p-4 space-y-4">
              {/* Robot Selection Notice */}
              <div className="bg-yellow-50 border-2 border-yellow-400 rounded-xl p-4">
                <div className="flex items-start gap-2">
                  <span className="text-2xl">🤖</span>
                  <div>
                    <h3 className="font-bold text-yellow-900 mb-1">Scout Robot #{currentRobotPosition}</h3>
                    <p className="text-sm text-yellow-800">
                      Focus on the <strong>robot in position {currentRobotPosition}</strong> of the {currentMatch.alliance} alliance. 
                      Include points scored by the <strong>human player</strong> for this robot.
                    </p>
                  </div>
                </div>
              </div>

              {/* Progress Indicator */}
              <div className="bg-white rounded-xl shadow p-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm font-semibold">Session Progress</span>
                  <span className="text-sm text-gray-600">Robot {robotsCompleted + 1} of 3</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div 
                    className="h-2 rounded-full transition-all"
                    style={{ 
                      width: `${((robotsCompleted) / 3) * 100}%`,
                      backgroundColor: "#c42221"
                    }}
                  />
                </div>
              </div>

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

              {/* NOTES - COLLAPSIBLE */}
              <div className="bg-white rounded-xl shadow p-4">
                <button 
                  onClick={() => setNotesOpen(!notesOpen)}
                  className="w-full flex items-center justify-between text-lg font-semibold mb-2" 
                  style={{ color: "#c42221" }}
                >
                  <span>Notes</span>
                  <span className="text-gray-400">{notesOpen ? '▼' : '▶'}</span>
                </button>
                {notesOpen && (
                  <textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    className="w-full border rounded p-2 h-24 resize-none"
                    placeholder="Optional notes..."
                  />
                )}
              </div>

              {/* SUBMIT */}
              <div className="bg-white rounded-xl shadow p-4">
                <button
                  onClick={submitRobotData}
                  className="w-full py-3 rounded text-white font-semibold mb-2"
                  style={{ backgroundColor: "#c42221" }}
                >
                  Submit Robot {robotsCompleted + 1}
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

        {/* STEP 2.5: ROBOT COMPLETE - TAKE A BREAK */}
        {currentStep === 'robot-complete' && (
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="bg-white rounded-xl shadow-md p-8 max-w-md text-center">
              <div className="text-6xl mb-4">✅</div>
              <h1 className="text-3xl font-bold mb-2" style={{ color: "#c42221" }}>
                Robot {robotsCompleted}/3 Scouted!
              </h1>
              <p className="text-gray-600 mb-6">
                Great job! You've completed robot {robotsCompleted} of 3.
                {robotsCompleted < 3 ? " Take a break if you need one, then continue when you're ready." : ""}
              </p>

              <div className="mb-6">
                <div className="w-full bg-gray-200 rounded-full h-4">
                  <div 
                    className="h-4 rounded-full transition-all"
                    style={{ 
                      width: `${(robotsCompleted / 3) * 100}%`,
                      backgroundColor: "#c42221"
                    }}
                  />
                </div>
                <p className="text-sm text-gray-600 mt-2">{robotsCompleted} of 3 robots completed</p>
              </div>

              <button
                onClick={continueToNextRobot}
                className="w-full py-3 rounded text-white font-semibold mb-2"
                style={{ backgroundColor: "#c42221" }}
              >
                Continue to Robot {robotsCompleted + 1}
              </button>
              <button
                onClick={resetPractice}
                className="w-full py-2 rounded border-2 border-gray-300 text-gray-700 font-medium hover:bg-gray-50"
              >
                Exit Practice
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: RESULTS */}
        {currentStep === 'results' && sessionResults && (
          <div className="flex-1 p-8 overflow-auto">
            <div className="max-w-4xl mx-auto">
              <div className="bg-white rounded-xl shadow-md p-8 mb-6 text-center">
                <div className="text-6xl mb-4">
                  {sessionResults.accuracy >= 90 ? "🎉" : sessionResults.accuracy >= 75 ? "👍" : "📚"}
                </div>
                <h1 className="text-3xl font-bold mb-2" style={{ color: "#c42221" }}>
                  Practice Session Complete!
                </h1>
                <p className="text-gray-600 mb-6">You scouted all 3 robots. Here's how you did:</p>

                <div className="grid md:grid-cols-3 gap-6 mb-8">
                  <div className="p-6 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-600 mb-1">Your Accuracy</p>
                    <p className="text-4xl font-bold" style={{ color: "#c42221" }}>
                      {sessionResults.accuracy}%
                    </p>
                  </div>
                  <div className="p-6 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-600 mb-1">Your Score</p>
                    <p className="text-4xl font-bold text-gray-700">{sessionResults.scoutedScore}</p>
                  </div>
                  <div className="p-6 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-600 mb-1">Official Score</p>
                    <p className="text-4xl font-bold text-gray-700">{sessionResults.officialScore}</p>
                  </div>
                </div>

                <div className="text-left bg-blue-50 p-6 rounded-lg mb-6">
                  <h3 className="font-semibold mb-2 text-blue-900">💡 What This Means</h3>
                  {sessionResults.accuracy >= 95 ? (
                    <p className="text-gray-700">Excellent work! You're ready for competition scouting. Your accuracy is outstanding!</p>
                  ) : sessionResults.accuracy >= 85 ? (
                    <p className="text-gray-700">Good job! You're getting close. Try a few more practice sessions to improve your accuracy.</p>
                  ) : sessionResults.accuracy >= 75 ? (
                    <p className="text-gray-700">Not bad! Keep practicing to improve. Focus on tracking all scoring actions carefully.</p>
                  ) : (
                    <p className="text-gray-700">Keep practicing! Review the game manual and try focusing on one scoring type at a time.</p>
                  )}
                </div>

                <div className="flex gap-4">
                  <button
                    onClick={resetPractice}
                    className="flex-1 py-3 rounded text-white font-semibold"
                    style={{ backgroundColor: "#c42221" }}
                  >
                    Practice Again
                  </button>
                  <button
                    onClick={() => router.push('/scout-dashboard')}
                    className="flex-1 py-3 rounded border-2 text-gray-700 font-semibold hover:bg-gray-50"
                    style={{ borderColor: "#c42221" }}
                  >
                    Back to Dashboard
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </ProtectedRoute>
  );
}

export default function PracticeScouting() {
  return <PracticeScoutingContent />;
}

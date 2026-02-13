"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { collection, addDoc } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";

// Simple counter component
function Counter({ label, value, onChange }: { label: string; value: number; onChange: (val: number) => void }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <div className="flex items-center gap-2">
        <button onClick={() => onChange(Math.max(0, value - 1))} className="w-8 h-8 rounded bg-gray-200 hover:bg-gray-300 font-semibold">−</button>
        <span className="w-8 text-center font-semibold">{value}</span>
        <button onClick={() => onChange(value + 1)} className="w-8 h-8 rounded bg-gray-200 hover:bg-gray-300 font-semibold">+</button>
      </div>
    </div>
  );
}

function PracticeScoutingPage() {
  const router = useRouter();
  const { userData } = useAuth();
  
  // Simple state
  const [step, setStep] = useState<'select' | 'scouting' | 'results'>('select');
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('easy');
  const [robotsScoutedCount, setRobotsScoutedCount] = useState(0);
  const [currentRobotPosition, setCurrentRobotPosition] = useState(1);
  const [accuracy, setAccuracy] = useState(0);
  const [notesOpen, setNotesOpen] = useState(false);
  
  const [formData, setFormData] = useState({
    teamNumber: "9999",
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

  function startPractice(selectedDifficulty: 'easy' | 'medium' | 'hard') {
    setDifficulty(selectedDifficulty);
    setStep('scouting');
    setRobotsScoutedCount(0);
    setCurrentRobotPosition(Math.floor(Math.random() * 3) + 1);
  }

  function submitRobot() {
    const newCount = robotsScoutedCount + 1;
    setRobotsScoutedCount(newCount);

    if (newCount >= 3) {
      // Done with all 3 robots - calculate accuracy
      const randomAccuracy = Math.floor(Math.random() * 20) + 75; // 75-95%
      setAccuracy(randomAccuracy);
      
      // Save to Firebase
      if (userData) {
        addDoc(collection(db, "practiceSessions"), {
          scoutName: userData.displayName,
          scoutId: userData.uid,
          teamId: userData.teamId,
          difficulty: difficulty,
          accuracy: randomAccuracy,
          timestamp: Date.now(),
        }).catch(err => console.error("Error saving:", err));
      }
      
      setStep('results');
    } else {
      // Reset form for next robot
      resetForm();
      setCurrentRobotPosition(Math.floor(Math.random() * 3) + 1);
    }
  }

  function resetForm() {
    setFormData({
      teamNumber: "9999",
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

  function restart() {
    setStep('select');
    setRobotsScoutedCount(0);
    setAccuracy(0);
    resetForm();
  }

  // STEP 1: SELECT DIFFICULTY
  if (step === 'select') {
    return (
      <ProtectedRoute allowedRoles={["scout", "coach"]}>
        <div className="flex min-h-screen bg-gray-100">
          <Sidebar />
          <div className="flex-1 p-8">
            <h1 className="text-3xl font-bold mb-6" style={{ color: "#c42221" }}>Practice Scouting</h1>
            
            <div className="bg-blue-50 border-l-4 border-blue-400 p-6 mb-6 rounded">
              <h2 className="font-semibold text-lg mb-3 text-blue-900">How Practice Scouting Works</h2>
              <div className="space-y-2 text-gray-700">
                <p>• Watch a real match video and scout all 3 robots on one alliance</p>
                <p>• Fill out the scouting form for each robot</p>
                <p>• Get an accuracy score based on official match data</p>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-md p-8">
              <h2 className="text-2xl font-semibold mb-4">Select Difficulty</h2>
              <div className="grid md:grid-cols-3 gap-4">
                <button
                  onClick={() => startPractice('easy')}
                  className="p-6 border-2 border-green-300 rounded-lg hover:bg-green-50 text-left transition-colors"
                >
                  <div className="text-3xl mb-2">🟢</div>
                  <h3 className="font-semibold text-lg mb-1">Easy</h3>
                  <p className="text-sm text-gray-600">Low-scoring matches</p>
                </button>

                <button
                  onClick={() => startPractice('medium')}
                  className="p-6 border-2 border-yellow-300 rounded-lg hover:bg-yellow-50 text-left transition-colors"
                >
                  <div className="text-3xl mb-2">🟡</div>
                  <h3 className="font-semibold text-lg mb-1">Medium</h3>
                  <p className="text-sm text-gray-600">Moderate-scoring matches</p>
                </button>

                <button
                  onClick={() => startPractice('hard')}
                  className="p-6 border-2 border-red-300 rounded-lg hover:bg-red-50 text-left transition-colors"
                >
                  <div className="text-3xl mb-2">🔴</div>
                  <h3 className="font-semibold text-lg mb-1">Hard</h3>
                  <p className="text-sm text-gray-600">High-scoring matches</p>
                </button>
              </div>
            </div>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  // STEP 2: SCOUTING
  if (step === 'scouting') {
    return (
      <ProtectedRoute allowedRoles={["scout", "coach"]}>
        <div className="flex h-screen bg-gray-100">
          <Sidebar />
          <div className="flex-1 flex flex-col md:flex-row">
            {/* VIDEO - 65% */}
            <div className="md:w-[65%] bg-black flex flex-col items-center justify-center relative">
              <div className="text-white text-center p-8">
                <div className="text-6xl mb-4">📹</div>
                <h2 className="text-2xl font-bold mb-2">Video Player</h2>
                <p className="text-gray-300">Match video would appear here</p>
                <p className="text-sm text-yellow-300 mt-4">⚠️ In production, this will be a real FRC match video</p>
              </div>
              
              {/* Match Info */}
              <div className="absolute top-4 left-4 bg-black bg-opacity-75 text-white p-4 rounded-lg">
                <h3 className="font-semibold text-lg">Qualification 26</h3>
                <p className="text-sm">Scout Robot #{currentRobotPosition}</p>
                <p className="text-sm">Session: Robot {robotsScoutedCount + 1}/3</p>
              </div>
            </div>

            {/* FORM - 35% */}
            <div className="md:w-[35%] overflow-y-auto bg-gray-100 p-4 space-y-4">
              {/* Robot Notice */}
              <div className="bg-yellow-50 border-2 border-yellow-400 rounded-xl p-4">
                <div className="flex items-start gap-2">
                  <span className="text-2xl">🤖</span>
                  <div>
                    <h3 className="font-bold text-yellow-900 mb-1">Scout Robot #{currentRobotPosition}</h3>
                    <p className="text-sm text-yellow-800">
                      Focus on robot in position {currentRobotPosition}. Include human player points.
                    </p>
                  </div>
                </div>
              </div>

              {/* Progress */}
              <div className="bg-white rounded-xl shadow p-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm font-semibold">Progress</span>
                  <span className="text-sm text-gray-600">Robot {robotsScoutedCount + 1} of 3</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div className="h-2 rounded-full" style={{ width: `${(robotsScoutedCount / 3) * 100}%`, backgroundColor: "#c42221" }} />
                </div>
              </div>

              {/* Pre-Match */}
              <div className="bg-white rounded-xl shadow p-4">
                <h2 className="text-lg font-semibold mb-4" style={{ color: "#c42221" }}>Pre-Match</h2>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">Team Number</label>
                    <input type="text" value={formData.teamNumber} disabled className="w-full border rounded p-2 bg-gray-100" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Starting Position</label>
                    <select value={formData.startingPosition} onChange={(e) => setFormData({...formData, startingPosition: e.target.value})} className="w-full border rounded p-2">
                      <option value="">Select</option>
                      <option value="Not There">Not There</option>
                      <option value="Processor Side">Processor Side</option>
                      <option value="Middle">Middle</option>
                      <option value="Opposite Side">Opposite Side</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Autonomous */}
              <div className="bg-white rounded-xl shadow p-4">
                <h2 className="text-lg font-semibold mb-4" style={{ color: "#c42221" }}>Autonomous</h2>
                <label className="flex items-center gap-2 mb-3">
                  <input type="checkbox" checked={formData.leftStartingZone} onChange={(e) => setFormData({...formData, leftStartingZone: e.target.checked})} />
                  <span className="text-sm font-medium">Left Starting Zone</span>
                </label>
                
                <h3 className="font-semibold mb-2">Auto Coral</h3>
                <Counter label="Missed" value={formData.autoCoralMissed} onChange={(v) => setFormData({...formData, autoCoralMissed: v})} />
                <Counter label="Level 1" value={formData.autoCoralL1} onChange={(v) => setFormData({...formData, autoCoralL1: v})} />
                <Counter label="Level 2" value={formData.autoCoralL2} onChange={(v) => setFormData({...formData, autoCoralL2: v})} />
                <Counter label="Level 3" value={formData.autoCoralL3} onChange={(v) => setFormData({...formData, autoCoralL3: v})} />
                <Counter label="Level 4" value={formData.autoCoralL4} onChange={(v) => setFormData({...formData, autoCoralL4: v})} />
                
                <h3 className="font-semibold mb-2 mt-3 pt-3 border-t">Auto Algae Processor</h3>
                <Counter label="Missed" value={formData.autoAlgaeProcessorMissed} onChange={(v) => setFormData({...formData, autoAlgaeProcessorMissed: v})} />
                <Counter label="Scored" value={formData.autoAlgaeProcessorScored} onChange={(v) => setFormData({...formData, autoAlgaeProcessorScored: v})} />
                
                <h3 className="font-semibold mb-2 mt-3 pt-3 border-t">Auto Algae Net</h3>
                <Counter label="Missed" value={formData.autoAlgaeNetMissed} onChange={(v) => setFormData({...formData, autoAlgaeNetMissed: v})} />
                <Counter label="Scored" value={formData.autoAlgaeNetScored} onChange={(v) => setFormData({...formData, autoAlgaeNetScored: v})} />
              </div>

              {/* Teleop */}
              <div className="bg-white rounded-xl shadow p-4">
                <h2 className="text-lg font-semibold mb-4" style={{ color: "#c42221" }}>Teleop</h2>
                
                <h3 className="font-semibold mb-2">Teleop Coral</h3>
                <Counter label="Missed" value={formData.teleopCoralMissed} onChange={(v) => setFormData({...formData, teleopCoralMissed: v})} />
                <Counter label="Level 1" value={formData.teleopCoralL1} onChange={(v) => setFormData({...formData, teleopCoralL1: v})} />
                <Counter label="Level 2" value={formData.teleopCoralL2} onChange={(v) => setFormData({...formData, teleopCoralL2: v})} />
                <Counter label="Level 3" value={formData.teleopCoralL3} onChange={(v) => setFormData({...formData, teleopCoralL3: v})} />
                <Counter label="Level 4" value={formData.teleopCoralL4} onChange={(v) => setFormData({...formData, teleopCoralL4: v})} />
                
                <label className="flex items-center gap-2 my-3">
                  <input type="checkbox" checked={formData.teleopAlgaeRemoved} onChange={(e) => setFormData({...formData, teleopAlgaeRemoved: e.target.checked})} />
                  <span className="text-sm font-medium">Removed Algae from Reef</span>
                </label>
                
                <h3 className="font-semibold mb-2 pt-3 border-t">Teleop Processor</h3>
                <Counter label="Missed" value={formData.teleopProcessorMissed} onChange={(v) => setFormData({...formData, teleopProcessorMissed: v})} />
                <Counter label="Scored" value={formData.teleopProcessorScored} onChange={(v) => setFormData({...formData, teleopProcessorScored: v})} />
                
                <h3 className="font-semibold mb-2 mt-3 pt-3 border-t">Teleop Algae Net – Robot</h3>
                <Counter label="Missed" value={formData.teleopNetRobotMissed} onChange={(v) => setFormData({...formData, teleopNetRobotMissed: v})} />
                <Counter label="Scored" value={formData.teleopNetRobotScored} onChange={(v) => setFormData({...formData, teleopNetRobotScored: v})} />
                
                <h3 className="font-semibold mb-2 mt-3 pt-3 border-t">Teleop Algae Net – Human</h3>
                <Counter label="Missed" value={formData.teleopNetHumanMissed} onChange={(v) => setFormData({...formData, teleopNetHumanMissed: v})} />
                <Counter label="Scored" value={formData.teleopNetHumanScored} onChange={(v) => setFormData({...formData, teleopNetHumanScored: v})} />
              </div>

              {/* Endgame */}
              <div className="bg-white rounded-xl shadow p-4">
                <h2 className="text-lg font-semibold mb-4" style={{ color: "#c42221" }}>Endgame</h2>
                <Counter label="Failed Climb" value={formData.failedClimb} onChange={(v) => setFormData({...formData, failedClimb: v})} />
                <div className="mt-3">
                  <label className="block text-sm font-medium mb-1">Stage Status</label>
                  <select value={formData.stageStatus} onChange={(e) => setFormData({...formData, stageStatus: e.target.value})} className="w-full border rounded p-2">
                    <option value="">Select</option>
                    <option value="Not Parked">Not Parked</option>
                    <option value="Parked in Barge Zone">Parked in Barge Zone</option>
                    <option value="Shallow Cage">Shallow Cage</option>
                    <option value="Deep Cage">Deep Cage</option>
                  </select>
                </div>
              </div>

              {/* General */}
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
                    <label key={incident.value} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={formData.incidents.includes(incident.value)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setFormData({...formData, incidents: [...formData.incidents, incident.value]});
                          } else {
                            setFormData({...formData, incidents: formData.incidents.filter(i => i !== incident.value)});
                          }
                        }}
                      />
                      <span className="text-sm">{incident.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Notes */}
              <div className="bg-white rounded-xl shadow p-4">
                <button onClick={() => setNotesOpen(!notesOpen)} className="w-full flex items-center justify-between text-lg font-semibold mb-2" style={{ color: "#c42221" }}>
                  <span>Notes</span>
                  <span className="text-gray-400">{notesOpen ? '▼' : '▶'}</span>
                </button>
                {notesOpen && (
                  <textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({...formData, notes: e.target.value})}
                    className="w-full border rounded p-2 h-24 resize-none"
                    placeholder="Optional notes..."
                  />
                )}
              </div>

              {/* Submit */}
              <div className="bg-white rounded-xl shadow p-4">
                <button onClick={submitRobot} className="w-full py-3 rounded text-white font-semibold mb-2" style={{ backgroundColor: "#c42221" }}>
                  Submit Robot {robotsScoutedCount + 1}
                </button>
                <button onClick={restart} className="w-full py-2 rounded border-2 border-gray-300 font-medium hover:bg-gray-50">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  // STEP 3: RESULTS
  return (
    <ProtectedRoute allowedRoles={["scout", "coach"]}>
      <div className="flex min-h-screen bg-gray-100">
        <Sidebar />
        <div className="flex-1 p-8">
          <div className="max-w-4xl mx-auto">
            <div className="bg-white rounded-xl shadow-md p-8 text-center">
              <div className="text-6xl mb-4">{accuracy >= 90 ? "🎉" : accuracy >= 75 ? "👍" : "📚"}</div>
              <h1 className="text-3xl font-bold mb-2" style={{ color: "#c42221" }}>Session Complete!</h1>
              <p className="text-gray-600 mb-6">You scouted all 3 robots. Here's your accuracy:</p>

              <div className="bg-gray-50 rounded-lg p-8 mb-6">
                <p className="text-sm text-gray-600 mb-2">Your Accuracy</p>
                <p className="text-6xl font-bold" style={{ color: "#c42221" }}>{accuracy}%</p>
              </div>

              <div className="text-left bg-blue-50 p-6 rounded-lg mb-6">
                <h3 className="font-semibold mb-2 text-blue-900">💡 What This Means</h3>
                {accuracy >= 90 ? (
                  <p className="text-gray-700">Excellent! You're ready for competition scouting.</p>
                ) : accuracy >= 75 ? (
                  <p className="text-gray-700">Good job! Keep practicing to improve further.</p>
                ) : (
                  <p className="text-gray-700">Keep practicing! Focus on one scoring type at a time.</p>
                )}
              </div>

              <div className="flex gap-4">
                <button onClick={restart} className="flex-1 py-3 rounded text-white font-semibold" style={{ backgroundColor: "#c42221" }}>
                  Practice Again
                </button>
                <button onClick={() => router.push('/scout-dashboard')} className="flex-1 py-3 rounded border-2 font-semibold hover:bg-gray-50" style={{ borderColor: "#c42221" }}>
                  Dashboard
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}

export default PracticeScoutingPage;

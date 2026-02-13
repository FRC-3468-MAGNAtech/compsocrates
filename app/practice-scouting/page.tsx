"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { collection, addDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";
import { PracticeMatch, PracticeSession, calculateScoutedScore, calculateAccuracy } from "@/app/utils/practiceTypes";
import { ChevronLeft, ChevronRight } from "lucide-react";

// Counter component
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

type PracticeMode = 'trial' | 'competitive';

function PracticeScoutingContent() {
  const router = useRouter();
  const { userData } = useAuth();
  const [currentStep, setCurrentStep] = useState<'select' | 'practice' | 'results'>('select');
  const [selectedDifficulty, setSelectedDifficulty] = useState<'easy' | 'medium' | 'hard' | null>(null);
  const [selectedMode, setSelectedMode] = useState<PracticeMode | null>(null);
  const [currentMatch, setCurrentMatch] = useState<PracticeMatch | null>(null);
  const [currentRobotIndex, setCurrentRobotIndex] = useState(0);
  const [robotSessions, setRobotSessions] = useState<any[]>([]);
  const [humanPlayerRobot, setHumanPlayerRobot] = useState<number | null>(null); // 0, 1, 2, or null
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

  function getYouTubeEmbedUrl(url: string): string {
    if (!url) return "";
    
    let videoId = "";
    
    if (url.includes("youtube.com/watch?v=")) {
      videoId = url.split("v=")[1]?.split("&")[0] || "";
    } else if (url.includes("youtu.be/")) {
      videoId = url.split("youtu.be/")[1]?.split("?")[0] || "";
    } else if (url.includes("youtube.com/embed/")) {
      videoId = url.split("embed/")[1]?.split("?")[0] || "";
    }
    
    if (!videoId) return url;
    
    const controls = selectedMode === 'trial' ? 1 : 0;
    
    return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&controls=${controls}&disablekb=${controls === 0 ? 1 : 0}&modestbranding=1&rel=0&fs=0`;
  }

  async function selectPracticeMatch(difficulty: 'easy' | 'medium' | 'hard', mode: PracticeMode) {
    setLoading(true);
    setSelectedDifficulty(difficulty);
    setSelectedMode(mode);

    try {
      const matchesQuery = query(
        collection(db, 'practiceMatches'),
        where('difficulty', '==', difficulty)
      );
      const matchesSnapshot = await getDocs(matchesQuery);
      const matches = matchesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as PracticeMatch[];

      if (matches.length === 0) {
        alert('No practice matches available for this difficulty.');
        setLoading(false);
        return;
      }

      const randomMatch = matches[Math.floor(Math.random() * matches.length)];
      setCurrentMatch(randomMatch);
      setCurrentRobotIndex(0);
      setRobotSessions([]);

     setFormData(prev => ({ ...prev, teamNumber: randomMatch.allianceTeams[0].toString() }));

      // Detect human player (usually position 2, but check match data)
      // For now, assume it's random or position 2
      // In a real scenario, this would come from TBA match data
      const humanPlayerPos = Math.floor(Math.random() * 3); // Random for demo
      setHumanPlayerRobot(humanPlayerPos);

      setCurrentStep('practice');
    } catch (error) {
      console.error('Error loading practice match:', error);
      alert('Error loading practice match.');
    } finally {
      setLoading(false);
    }
  }

setHumanPlayerRobot(null); // Reset human player tracking

  async function submitCurrentRobot() {
    if (!currentMatch || !userData) return;

    const robotData = { ...formData };
    setRobotSessions(prev => [...prev, robotData]);

    if (currentRobotIndex === 2) {
      await submitPracticeSession([...robotSessions, robotData]);
      return;
    }

    setCurrentRobotIndex(prev => prev + 1);
    
    const notes = formData.notes;
    setFormData({
      teamNumber: currentMatch.allianceTeams[currentRobotIndex + 1].toString(),
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
      notes,
    });
  }

  async function submitPracticeSession(allRobotData: any[]) {
    if (!currentMatch || !userData) return;

    setLoading(true);
    try {
      const scores = allRobotData.map(data => calculateScoutedScore(data));
      const avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);

      // Calculate accuracy using official score
      const accuracies = scores.map(scoutedScore => calculateAccuracy(scoutedScore, currentMatch.officialData.score));
      const avgAccuracy = Math.round(accuracies.reduce((a, b) => a + b, 0) / accuracies.length);

      const session: any = {
        scoutName: userData.displayName,
        matchId: currentMatch.id || '',
        matchNumber: currentMatch.matchNumber,
        matchType: currentMatch.matchType || 'practice',
        difficulty: selectedDifficulty || 'easy',
        mode: selectedMode || 'trial',
        scoutedData: allRobotData[0],
        officialScore: currentMatch.officialData.score,
        scoutedScore: avgScore,
        accuracy: avgAccuracy,
        timestamp: Date.now(),
      };

      const docRef = await addDoc(collection(db, 'practiceSessions'), session);
      setSessionResults({ ...session, id: docRef.id });
      setCurrentStep('results');
    } catch (error) {
      console.error('Error submitting practice session:', error);
      alert('Error submitting practice session: ' + (error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function resetPractice() {
    setCurrentStep('select');
    setSelectedDifficulty(null);
    setSelectedMode(null);
    setCurrentMatch(null);
    setCurrentRobotIndex(0);
    setRobotSessions([]);
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
        {/* STEP 1: MODE & DIFFICULTY SELECTION */}
        {currentStep === 'select' && (
          <div className="p-4 md:p-8 max-w-4xl mx-auto">
            <h1 className="text-2xl md:text-3xl font-bold mb-2" style={{ color: "#c42221" }}>
              Practice Scouting
            </h1>
            <p className="text-gray-600 mb-8">Improve your accuracy by practicing with real match footage.</p>

            {!selectedMode ? (
              <>
                <h2 className="text-xl font-semibold mb-4">Select Mode</h2>
                <div className="grid md:grid-cols-2 gap-4 mb-8">
                  <button
                    onClick={() => setSelectedMode('trial')}
                    className="p-6 border-2 border-blue-300 rounded-lg hover:bg-blue-50 text-left transition-colors"
                  >
                    <div className="text-3xl mb-2">🎓</div>
                    <h3 className="font-semibold text-lg mb-1">Trial Mode</h3>
                    <p className="text-sm text-gray-600 mb-2">For Learning</p>
                    <ul className="text-xs text-gray-500 space-y-1">
                      <li>• Video can be paused</li>
                      <li>• Practice at your own pace</li>
                      <li>• Separate leaderboard</li>
                    </ul>
                  </button>

                  <button
                    onClick={() => setSelectedMode('competitive')}
                    className="p-6 border-2 border-red-300 rounded-lg hover:bg-red-50 text-left transition-colors"
                  >
                    <div className="text-3xl mb-2">🏆</div>
                    <h3 className="font-semibold text-lg mb-1">Competitive Mode</h3>
                    <p className="text-sm text-gray-600 mb-2">Test Your Skills</p>
                    <ul className="text-xs text-gray-500 space-y-1">
                      <li>• Video cannot be paused</li>
                      <li>• Real match conditions</li>
                      <li>• Separate leaderboard</li>
                    </ul>
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-semibold">Select Difficulty</h2>
                  <button
                    onClick={() => setSelectedMode(null)}
                    className="text-sm text-gray-600 hover:text-gray-800"
                  >
                    ← Change Mode
                  </button>
                </div>
                <div className="grid md:grid-cols-3 gap-4">
                  <button
                    onClick={() => selectPracticeMatch('easy', selectedMode)}
                    disabled={loading}
                    className="p-6 border-2 border-green-300 rounded-lg hover:bg-green-50 text-left transition-colors disabled:opacity-50"
                  >
                    <div className="text-3xl mb-2">🟢</div>
                    <h3 className="font-semibold text-lg mb-1">Easy</h3>
                    <p className="text-sm text-gray-600">Low-scoring matches</p>
                  </button>

                  <button
                    onClick={() => selectPracticeMatch('medium', selectedMode)}
                    disabled={loading}
                    className="p-6 border-2 border-yellow-300 rounded-lg hover:bg-yellow-50 text-left transition-colors disabled:opacity-50"
                  >
                    <div className="text-3xl mb-2">🟡</div>
                    <h3 className="font-semibold text-lg mb-1">Medium</h3>
                    <p className="text-sm text-gray-600">Average matches</p>
                  </button>

                  <button
                    onClick={() => selectPracticeMatch('hard', selectedMode)}
                    disabled={loading}
                    className="p-6 border-2 border-red-300 rounded-lg hover:bg-red-50 text-left transition-colors disabled:opacity-50"
                  >
                    <div className="text-3xl mb-2">🔴</div>
                    <h3 className="font-semibold text-lg mb-1">Hard</h3>
                    <p className="text-sm text-gray-600">High-scoring matches</p>
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* STEP 2: PRACTICE SCOUTING */}
        {currentStep === 'practice' && currentMatch && (
          <div className="h-screen flex flex-col md:flex-row">
            {/* VIDEO PLAYER */}
            <div className="flex-1 bg-black flex flex-col">
              <div className="flex-1 flex items-center justify-center relative">
                <iframe
                  src={getYouTubeEmbedUrl(currentMatch.videoUrl)}
                  className="w-full h-full"
                  allow="autoplay; encrypted-media"
                  title="Practice Match Video"
                  frameBorder="0"
                />
              </div>

              {/* Match Info */}
              <div className="bg-black bg-opacity-90 text-white p-4">
                <h3 className="font-semibold text-lg">
                  {currentMatch.matchType === 'qualification' ? 'Qualification' : 
                   currentMatch.matchType === 'playoff' ? 'Playoff' : 'Practice'} Match {currentMatch.matchNumber}
                </h3>
                <p className="text-sm">Robot {currentRobotIndex + 1} of 3 • Team {currentMatch.allianceTeams[currentRobotIndex]}</p>
                <p className="text-sm capitalize">{currentMatch.alliance} Alliance • {selectedMode} Mode</p>
                {selectedMode === 'competitive' && (
                  <p className="text-xs mt-2 text-yellow-300">⚠️ Video cannot be paused</p>
                )}
              </div>
            </div>

            {/* SCOUTING FORM */}
            <div className="w-full md:w-96 overflow-y-auto bg-gray-100 p-4 space-y-4">
              {/* Progress indicator */}
              <div className="bg-white rounded-lg p-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm font-semibold">Progress</span>
                  <span className="text-sm text-gray-600">Robot {currentRobotIndex + 1}/3</span>
                </div>
                <div className="flex gap-2">
                  {[0, 1, 2].map(i => (
                    <div
                      key={i}
                      className={`flex-1 h-2 rounded ${
                        i < currentRobotIndex ? 'bg-green-500' :
                        i === currentRobotIndex ? 'bg-blue-500' :
                        'bg-gray-200'
                      }`}
                    />
                  ))}
                </div>
              </div>

              {humanPlayerRobot === currentRobotIndex && (
                <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-4">
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div className="ml-3">
                      <p className="text-sm font-medium text-yellow-800">
                        ⚠️ This match, include the <strong>Human Player</strong>
                      </p>
                      <p className="text-xs text-yellow-700 mt-1">
                        They operate a player station instead of a robot on the field
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* PRE-MATCH INFO */}
              <div className="bg-white rounded-xl shadow p-4">
                <h2 className="text-lg font-semibold mb-4" style={{ color: "#c42221" }}>Pre-Match Info</h2>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Team Number</label>
                    <input type="text" value={formData.teamNumber} disabled className="w-full border rounded p-2 bg-gray-100 text-gray-600" />
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
                    <option value="None">None</option>
                    <option value="Parked">Parked</option>
                    <option value="Shallow">Shallow</option>
                    <option value="Deep">Deep</option>
                  </select>
                </div>
              </div>

              {/* GENERAL */}
              <div className="bg-white rounded-xl shadow p-4">
                <h2 className="text-lg font-semibold mb-4" style={{ color: "#c42221" }}>General</h2>
                <div className="space-y-2">
                  {['Died During Match', 'Never Started Match', 'Disabled by FRC', 'Recovered from Freeze', 'Tipped Over', 'Yellow Card', 'Red Card'].map((incident) => (
                    <label key={incident} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.incidents.includes(incident)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setFormData({ ...formData, incidents: [...formData.incidents, incident] });
                          } else {
                            setFormData({ ...formData, incidents: formData.incidents.filter(i => i !== incident) });
                          }
                        }}
                        className="w-4 h-4"
                      />
                      <span className="text-sm">{incident}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* SUBMIT BUTTON */}
              <div className="sticky bottom-0 bg-gray-100 pt-4 pb-2 space-y-2">
                <button
                  onClick={submitCurrentRobot}
                  disabled={loading}
                  className="w-full py-3 rounded-lg text-white font-semibold disabled:opacity-50"
                  style={{ backgroundColor: "#c42221" }}
                >
                  {loading ? "Submitting..." : 
                   currentRobotIndex === 2 ? "Finish Session" : 
                   `Next Robot (${currentRobotIndex + 2}/3)`}
                </button>
                <button
                  onClick={resetPractice}
                  className="w-full py-2 rounded-lg border-2 border-gray-300 font-semibold hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </div>

            {/* NOTES TOGGLE BUTTON */}
            <button
              onClick={() => setNotesOpen(!notesOpen)}
              className="hidden md:block fixed right-0 top-1/2 -translate-y-1/2 bg-red-600 text-white px-2 py-8 rounded-l-lg shadow-lg hover:bg-red-700 z-10"
            >
              {notesOpen ? <ChevronRight /> : <ChevronLeft />}
            </button>

            {/* NOTES PANEL */}
            <div className={`bg-white shadow-xl transition-all duration-300 overflow-y-auto ${notesOpen ? 'w-80' : 'w-0'} hidden md:block`}>
              {notesOpen && (
                <div className="p-4">
                  <h2 className="text-lg font-semibold mb-4" style={{ color: "#c42221" }}>Notes</h2>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    className="w-full border rounded p-2 h-96"
                    placeholder="Optional notes..."
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* STEP 3: RESULTS */}
        {currentStep === 'results' && sessionResults && (
          <div className="p-4 md:p-8 max-w-4xl mx-auto">
            <h1 className="text-2xl md:text-3xl font-bold mb-2" style={{ color: "#c42221" }}>
              Practice Complete!
            </h1>
            <p className="text-gray-600 mb-8">You've completed all 3 robots. Here's your score:</p>

            <div className="bg-white rounded-xl shadow-md p-8 mb-6 text-center">
              <div className="inline-block px-4 py-1 bg-blue-100 text-blue-800 rounded-full text-sm mb-4">
                {selectedMode === 'trial' ? 'Trial Mode' : 'Competitive Mode'}
              </div>
              <h2 className="text-xl font-semibold mb-2">Your Accuracy</h2>
              <div className="text-6xl font-bold mb-4" style={{ color: sessionResults.accuracy >= 90 ? "#22c55e" : sessionResults.accuracy >= 75 ? "#eab308" : "#ef4444" }}>
                {sessionResults.accuracy}%
              </div>
              <p className="text-gray-600">Average across all 3 robots</p>
            </div>

            <div className="bg-white rounded-xl shadow-md p-8 mb-6">
              <h2 className="text-xl font-semibold mb-4">Score Comparison</h2>
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <h3 className="font-semibold mb-2">Your Scouted Score</h3>
                  <p className="text-4xl font-bold" style={{ color: "#c42221" }}>{sessionResults.scoutedScore}</p>
                </div>
                <div>
                  <h3 className="font-semibold mb-2">Actual Score</h3>
                  <p className="text-4xl font-bold text-gray-700">{sessionResults.officialScore}</p>
                </div>
              </div>
            </div>

            <div className="flex gap-4">
              <button onClick={resetPractice} className="flex-1 py-3 rounded-lg text-white font-semibold" style={{ backgroundColor: "#c42221" }}>
                Practice Again
              </button>
              <button onClick={() => router.push("/scout-dashboard")} className="flex-1 py-3 rounded-lg border-2 border-gray-300 font-semibold hover:bg-gray-50">
                Dashboard
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function PracticeScouting() {
  return (
    <ProtectedRoute requireAuth={true}>
      <PracticeScoutingContent />
    </ProtectedRoute>
  );
}
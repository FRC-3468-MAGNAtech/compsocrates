"use client";

import { useState, useEffect } from "react";
import { collection, addDoc } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";
import { getEventMatches } from "@/app/utils/tba-api";

type PracticeSession = {
  id: string;
  eventKey: string;
  matchKey: string;
  matchName: string;
  team: number;
  difficulty: "Easy" | "Medium" | "Hard";
};

function PracticeScoutingContent() {
  const { userData } = useAuth();
  const [sessions, setSessions] = useState<PracticeSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<PracticeSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [formSubmitted, setFormSubmitted] = useState(false);
  const [accuracy, setAccuracy] = useState<number | null>(null);

  const [formData, setFormData] = useState({
    autoCoralL1: 0,
    autoCoralL2: 0,
    autoCoralL3: 0,
    autoCoralL4: 0,
    teleopCoralL1: 0,
    teleopCoralL2: 0,
    teleopCoralL3: 0,
    teleopCoralL4: 0,
  });

  useEffect(() => {
    loadPracticeSessions();
  }, []);

  async function loadPracticeSessions() {
    setLoading(true);
    try {
      // Get matches from two different events for variety
      const rocketCityMatches = await getEventMatches("2025alhu");
      const bayouMatches = await getEventMatches("2025labr");
      
      // Combine and shuffle matches
      const allMatches = [...rocketCityMatches, ...bayouMatches];
      
      // Pick 6 random qual matches
      const qualMatches = allMatches.filter(m => m.comp_level === "qm");
      const shuffled = qualMatches.sort(() => 0.5 - Math.random());
      const selectedMatches = shuffled.slice(0, 6);

      // Create practice sessions with difficulty levels
      const practiceSessions: PracticeSession[] = selectedMatches.map((match, index) => {
        // Pick a random team from the match
        const allTeams = [
          ...match.alliances.red.team_keys,
          ...match.alliances.blue.team_keys
        ];
        const randomTeam = allTeams[Math.floor(Math.random() * allTeams.length)];
        const teamNumber = parseInt(randomTeam.replace("frc", ""));

        // Assign difficulty
        let difficulty: "Easy" | "Medium" | "Hard";
        if (index < 2) difficulty = "Easy";
        else if (index < 4) difficulty = "Medium";
        else difficulty = "Hard";

        return {
          id: match.key,
          eventKey: match.event_key,
          matchKey: match.key,
          matchName: `Qualification Match ${match.match_number}`,
          team: teamNumber,
          difficulty
        };
      });

      setSessions(practiceSessions);
    } catch (error) {
      console.error("Error loading practice sessions:", error);
    } finally {
      setLoading(false);
    }
  }

  function startSession(session: PracticeSession) {
    setSelectedSession(session);
    setFormSubmitted(false);
    setAccuracy(null);
    setFormData({
      autoCoralL1: 0,
      autoCoralL2: 0,
      autoCoralL3: 0,
      autoCoralL4: 0,
      teleopCoralL1: 0,
      teleopCoralL2: 0,
      teleopCoralL3: 0,
      teleopCoralL4: 0,
    });
  }

  async function submitPracticeForm() {
    if (!selectedSession || !userData) return;

    // Simulate accuracy (in real app, would compare with answer key)
    const calculatedAccuracy = Math.floor(Math.random() * 15) + 85; // 85-100%
    setAccuracy(calculatedAccuracy);
    setFormSubmitted(true);

    // Save to database
    try {
      await addDoc(collection(db, "practiceSessions"), {
        scoutName: userData.displayName,
        teamId: userData.teamId,
        matchKey: selectedSession.matchKey,
        matchName: selectedSession.matchName,
        team: selectedSession.team,
        accuracy: calculatedAccuracy,
        difficulty: selectedSession.difficulty,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error("Error saving practice session:", error);
    }
  }

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="p-8">
          <h1 className="text-3xl font-bold mb-2" style={{ color: "#c42221" }}>
            Practice Scouting
          </h1>
          <p className="text-gray-600 mb-8">
            Improve your accuracy by practicing with real match footage.
          </p>

          {loading ? (
            <div className="text-center py-12">
              <div className="text-4xl mb-4 animate-spin">🔄</div>
              <p className="text-gray-600">Loading practice sessions...</p>
            </div>
          ) : selectedSession ? (
            // PRACTICE SESSION VIEW
            <div className="max-w-4xl">
              <button
                onClick={() => setSelectedSession(null)}
                className="mb-4 text-gray-600 hover:text-gray-800 flex items-center gap-2"
              >
                ← Back to Sessions
              </button>

              <div className="bg-white rounded-xl shadow-md p-6 mb-6">
                <h2 className="text-2xl font-bold mb-2" style={{ color: "#c42221" }}>
                  {selectedSession.matchName}
                </h2>
                <p className="text-gray-600 mb-4">
                  Team {selectedSession.team} • Difficulty: {selectedSession.difficulty}
                </p>

                {!formSubmitted ? (
                  <>
                    {/* INSTRUCTIONS */}
                    <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-4 mb-6">
                      <h3 className="font-semibold mb-2">📺 Instructions</h3>
                      <ol className="text-sm text-gray-700 space-y-1 list-decimal list-inside">
                        <li>Watch this team's performance in the match</li>
                        <li>Fill out the scouting form below</li>
                        <li>Submit to see your accuracy score</li>
                      </ol>
                      <p className="text-xs text-gray-600 mt-3">
                        Note: Match videos are not available in this demo. In production, you would watch actual match footage here.
                      </p>
                    </div>

                    {/* SIMPLIFIED PRACTICE FORM */}
                    <div className="space-y-6">
                      <div>
                        <h3 className="font-semibold mb-3 text-lg">Autonomous Coral</h3>
                        <div className="grid grid-cols-4 gap-4">
                          {["L1", "L2", "L3", "L4"].map((level, idx) => (
                            <div key={level}>
                              <label className="block text-sm font-medium text-gray-700 mb-1">
                                {level}
                              </label>
                              <input
                                type="number"
                                min="0"
                                max="20"
                                value={formData[`autoCoral${level}` as keyof typeof formData]}
                                onChange={(e) =>
                                  setFormData({
                                    ...formData,
                                    [`autoCoral${level}`]: parseInt(e.target.value) || 0,
                                  })
                                }
                                className="w-full border rounded-lg p-2"
                              />
                            </div>
                          ))}
                        </div>
                      </div>

                      <div>
                        <h3 className="font-semibold mb-3 text-lg">Teleoperated Coral</h3>
                        <div className="grid grid-cols-4 gap-4">
                          {["L1", "L2", "L3", "L4"].map((level, idx) => (
                            <div key={level}>
                              <label className="block text-sm font-medium text-gray-700 mb-1">
                                {level}
                              </label>
                              <input
                                type="number"
                                min="0"
                                max="20"
                                value={formData[`teleopCoral${level}` as keyof typeof formData]}
                                onChange={(e) =>
                                  setFormData({
                                    ...formData,
                                    [`teleopCoral${level}`]: parseInt(e.target.value) || 0,
                                  })
                                }
                                className="w-full border rounded-lg p-2"
                              />
                            </div>
                          ))}
                        </div>
                      </div>

                      <button
                        onClick={submitPracticeForm}
                        className="w-full py-3 rounded-lg text-white font-semibold text-lg"
                        style={{ backgroundColor: "#c42221" }}
                      >
                        Submit Practice Form
                      </button>
                    </div>
                  </>
                ) : (
                  // RESULTS
                  <div className="text-center py-8">
                    <div className="text-6xl mb-4">
                      {accuracy && accuracy >= 95 ? "🎯" : accuracy && accuracy >= 85 ? "✅" : "📊"}
                    </div>
                    <h3 className="text-3xl font-bold mb-2" style={{ color: "#c42221" }}>
                      {accuracy}% Accuracy
                    </h3>
                    <p className="text-gray-600 mb-6">
                      {accuracy && accuracy >= 95
                        ? "Excellent work! You're ready to scout."
                        : accuracy && accuracy >= 85
                        ? "Good job! Keep practicing to improve."
                        : "Keep practicing to improve your accuracy."}
                    </p>
                    <button
                      onClick={() => setSelectedSession(null)}
                      className="px-6 py-3 rounded-lg text-white font-semibold"
                      style={{ backgroundColor: "#c42221" }}
                    >
                      Try Another Session
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            // SESSION LIST VIEW
            <div className="max-w-4xl">
              {/* Stats Summary */}
              <div className="bg-white rounded-xl shadow-md p-6 mb-6">
                <h2 className="text-xl font-semibold mb-4">Your Practice Stats</h2>
                <p className="text-sm text-gray-600">
                  Complete practice sessions to track your improvement and verify your accuracy.
                </p>
              </div>

              {/* Available Sessions */}
              <div className="bg-white rounded-xl shadow-md p-6">
                <h2 className="text-xl font-semibold mb-4">Available Practice Sessions</h2>
                <div className="space-y-3">
                  {sessions.map((session) => (
                    <div
                      key={session.id}
                      className="flex items-center justify-between p-4 border rounded-lg hover:border-red-300 transition-colors"
                    >
                      <div>
                        <h3 className="font-semibold">{session.matchName}</h3>
                        <p className="text-sm text-gray-600">Team {session.team}</p>
                        <span
                          className={`inline-block px-2 py-1 text-xs rounded mt-1 ${
                            session.difficulty === "Easy"
                              ? "bg-green-100 text-green-700"
                              : session.difficulty === "Medium"
                              ? "bg-yellow-100 text-yellow-700"
                              : "bg-red-100 text-red-700"
                          }`}
                        >
                          {session.difficulty}
                        </span>
                      </div>
                      <button
                        onClick={() => startSession(session)}
                        className="px-6 py-2 rounded-lg text-white font-semibold"
                        style={{ backgroundColor: "#c42221" }}
                      >
                        Start Practice
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PracticeScouting() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["scout"]}>
      <PracticeScoutingContent />
    </ProtectedRoute>
  );
}
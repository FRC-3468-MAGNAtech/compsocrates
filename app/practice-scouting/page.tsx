"use client";

import { useState } from "react";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";

function PracticeScoutingContent() {
  const { userData } = useAuth();
  const [selectedSession, setSelectedSession] = useState<number | null>(null);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [formSubmitted, setFormSubmitted] = useState(false);
  const [accuracy, setAccuracy] = useState<number | null>(null);

  // Practice sessions (in real app, these would come from database)
  const sessions = [
    {
      id: 1,
      title: "2025 Reefscape - Qualification Match 12",
      team: 1234,
      difficulty: "Easy",
      videoUrl: "https://www.youtube.com/embed/example1", // Replace with actual match videos
      answerKey: {
        autoCoralL1: 2,
        autoCoralL2: 1,
        autoCoralL3: 0,
        autoCoralL4: 0,
        teleopCoralL1: 5,
        teleopCoralL2: 3,
        teleopCoralL3: 1,
        teleopCoralL4: 0,
        // ... etc
      }
    },
    {
      id: 2,
      title: "2025 Reefscape - Qualification Match 45",
      team: 5678,
      difficulty: "Medium",
      videoUrl: "https://www.youtube.com/embed/example2",
      answerKey: {}
    },
    {
      id: 3,
      title: "2025 Reefscape - Finals Match 2",
      team: 9012,
      difficulty: "Hard",
      videoUrl: "https://www.youtube.com/embed/example3",
      answerKey: {}
    },
  ];

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

  function startSession(sessionId: number) {
    setSelectedSession(sessionId);
    setVideoPlaying(false);
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

  function submitPracticeForm() {
    // In real app, compare formData with answerKey and calculate accuracy
    const session = sessions.find(s => s.id === selectedSession);
    if (session) {
      // Simulate accuracy calculation (random for demo)
      const calculatedAccuracy = Math.floor(Math.random() * 15) + 85; // 85-100%
      setAccuracy(calculatedAccuracy);
      setFormSubmitted(true);
      
      // In real app: Save practice session result to database
      // await addDoc(collection(db, "practice-sessions"), {
      //   userId: userData?.uid,
      //   sessionId: selectedSession,
      //   accuracy: calculatedAccuracy,
      //   timestamp: Date.now(),
      // });
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
            Watch recorded matches and practice your scouting skills. Get instant feedback on your accuracy!
          </p>

          {!selectedSession ? (
            <>
              {/* HOW IT WORKS */}
              <div className="bg-white rounded-xl shadow-md p-8 mb-6">
                <h2 className="text-2xl font-semibold mb-6">How Practice Works</h2>
                <div className="grid md:grid-cols-3 gap-6">
                  <div className="text-center">
                    <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center text-white text-2xl font-bold" style={{ backgroundColor: "#c42221" }}>
                      1
                    </div>
                    <h3 className="font-semibold mb-2">Watch a Match</h3>
                    <p className="text-sm text-gray-600">
                      We'll show you a pre-recorded match video. Follow along as if you were at the event.
                    </p>
                  </div>
                  <div className="text-center">
                    <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center text-white text-2xl font-bold" style={{ backgroundColor: "#c42221" }}>
                      2
                    </div>
                    <h3 className="font-semibold mb-2">Scout the Robot</h3>
                    <p className="text-sm text-gray-600">
                      Fill out the scouting form just like a real match. Track every action carefully.
                    </p>
                  </div>
                  <div className="text-center">
                    <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center text-white text-2xl font-bold" style={{ backgroundColor: "#c42221" }}>
                      3
                    </div>
                    <h3 className="font-semibold mb-2">Get Your Score</h3>
                    <p className="text-sm text-gray-600">
                      We'll compare your data to the verified answer key and show your accuracy.
                    </p>
                  </div>
                </div>
              </div>

              {/* YOUR STATS */}
              <div className="bg-white rounded-xl shadow-md p-6 mb-6">
                <h2 className="text-xl font-semibold mb-4">Your Practice Stats</h2>
                <div className="grid md:grid-cols-3 gap-4">
                  <div className="text-center p-4 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-600 mb-1">Sessions Completed</p>
                    <p className="text-3xl font-bold" style={{ color: "#c42221" }}>8</p>
                  </div>
                  <div className="text-center p-4 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-600 mb-1">Average Accuracy</p>
                    <p className="text-3xl font-bold" style={{ color: "#c42221" }}>96%</p>
                  </div>
                  <div className="text-center p-4 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-600 mb-1">Best Score</p>
                    <p className="text-3xl font-bold" style={{ color: "#c42221" }}>98%</p>
                  </div>
                </div>
              </div>

              {/* AVAILABLE SESSIONS */}
              <div className="bg-white rounded-xl shadow-md p-6">
                <h2 className="text-xl font-semibold mb-4">Available Practice Sessions</h2>
                <div className="space-y-4">
                  {sessions.map((session) => (
                    <div
                      key={session.id}
                      className="flex items-center justify-between p-4 border-2 border-gray-200 rounded-lg hover:border-red-300 transition-colors"
                    >
                      <div className="flex-1">
                        <h3 className="font-semibold text-lg">{session.title}</h3>
                        <p className="text-sm text-gray-600">Team {session.team}</p>
                        <div className="flex gap-2 mt-2">
                          <span className={`px-2 py-1 text-xs rounded ${
                            session.difficulty === "Easy" ? "bg-green-100 text-green-800" :
                            session.difficulty === "Medium" ? "bg-yellow-100 text-yellow-800" :
                            "bg-red-100 text-red-800"
                          }`}>
                            {session.difficulty}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() => startSession(session.id)}
                        className="px-6 py-3 rounded-lg text-white font-semibold"
                        style={{ backgroundColor: "#c42221" }}
                      >
                        Start Practice
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
              {/* PRACTICE SESSION VIEW */}
              <div className="bg-white rounded-xl shadow-md p-6 mb-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-semibold">
                    {sessions.find(s => s.id === selectedSession)?.title}
                  </h2>
                  <button
                    onClick={() => setSelectedSession(null)}
                    className="px-4 py-2 rounded-lg border border-gray-300 hover:bg-gray-50"
                  >
                    ← Back to Sessions
                  </button>
                </div>

                {/* VIDEO PLAYER */}
                <div className="mb-6">
                  <div className="aspect-video bg-black rounded-lg flex items-center justify-center">
                    {!videoPlaying ? (
                      <button
                        onClick={() => setVideoPlaying(true)}
                        className="px-8 py-4 rounded-lg text-white font-semibold text-lg"
                        style={{ backgroundColor: "#c42221" }}
                      >
                        ▶️ Play Match Video
                      </button>
                    ) : (
                      <div className="text-white text-center">
                        <p className="text-xl mb-2">🎥 Video Player</p>
                        <p className="text-sm">In production, this would embed the actual match video</p>
                        <p className="text-xs mt-2 text-gray-400">
                          (YouTube embed or custom video player)
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {!formSubmitted ? (
                  <>
                    {/* SIMPLIFIED PRACTICE FORM */}
                    <h3 className="text-lg font-semibold mb-4">Scout This Match</h3>
                    <div className="grid md:grid-cols-2 gap-6 mb-6">
                      <div>
                        <h4 className="font-semibold mb-3">Autonomous Coral Scored</h4>
                        <div className="space-y-2">
                          {["L1", "L2", "L3", "L4"].map((level) => (
                            <div key={level} className="flex items-center justify-between">
                              <label className="text-sm font-medium">Level {level.slice(1)}</label>
                              <input
                                type="number"
                                min="0"
                                value={formData[`autoCoralL${level.slice(1)}` as keyof typeof formData]}
                                onChange={(e) => setFormData({
                                  ...formData,
                                  [`autoCoralL${level.slice(1)}`]: parseInt(e.target.value) || 0
                                })}
                                className="w-20 border rounded p-2 text-center"
                              />
                            </div>
                          ))}
                        </div>
                      </div>

                      <div>
                        <h4 className="font-semibold mb-3">Teleop Coral Scored</h4>
                        <div className="space-y-2">
                          {["L1", "L2", "L3", "L4"].map((level) => (
                            <div key={level} className="flex items-center justify-between">
                              <label className="text-sm font-medium">Level {level.slice(1)}</label>
                              <input
                                type="number"
                                min="0"
                                value={formData[`teleopCoralL${level.slice(1)}` as keyof typeof formData]}
                                onChange={(e) => setFormData({
                                  ...formData,
                                  [`teleopCoralL${level.slice(1)}`]: parseInt(e.target.value) || 0
                                })}
                                className="w-20 border rounded p-2 text-center"
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={submitPracticeForm}
                      className="w-full py-3 rounded-lg text-white font-semibold text-lg"
                      style={{ backgroundColor: "#c42221" }}
                    >
                      Submit & Get Results
                    </button>
                  </>
                ) : (
                  <>
                    {/* RESULTS */}
                    <div className="text-center py-8">
                      <div className="text-6xl mb-4">
                        {accuracy && accuracy >= 95 ? "🌟" : accuracy && accuracy >= 85 ? "✅" : "📈"}
                      </div>
                      <h3 className="text-2xl font-bold mb-2">Your Accuracy Score</h3>
                      <p className="text-6xl font-bold mb-4" style={{ color: "#c42221" }}>
                        {accuracy}%
                      </p>
                      <p className="text-gray-600 mb-6">
                        {accuracy && accuracy >= 95 ? "Excellent work! You're ready for competition." :
                         accuracy && accuracy >= 85 ? "Good job! A few more practice sessions will help." :
                         "Keep practicing to improve your accuracy."}
                      </p>

                      <div className="flex gap-4 justify-center">
                        <button
                          onClick={() => setSelectedSession(null)}
                          className="px-6 py-3 rounded-lg border border-gray-300 hover:bg-gray-50 font-semibold"
                        >
                          Back to Sessions
                        </button>
                        <button
                          onClick={() => {
                            setFormSubmitted(false);
                            setVideoPlaying(false);
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
                          }}
                          className="px-6 py-3 rounded-lg text-white font-semibold"
                          style={{ backgroundColor: "#c42221" }}
                        >
                          Try Again
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
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
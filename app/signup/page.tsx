"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/app/AuthContext";
import { collection, query, where, getDocs, setDoc, doc } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";

function SignupContent() {
  const router = useRouter();
  const { signUp } = useAuth();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    confirmPassword: "",
    name: "",
    teamAction: "", // "join" or "create"
    teamNumber: "",
    teamName: "",
    role: "", // "coach" or "scout"
  });

  // Generate random team code
  function generateTeamCode(): string {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  // Check if team code exists
  async function teamCodeExists(code: string): Promise<boolean> {
    const q = query(collection(db, "teams"), where("teamId", "==", code));
    const snapshot = await getDocs(q);
    return !snapshot.empty;
  }

  // Check if team name already exists
  async function teamNameExists(name: string): Promise<boolean> {
    const q = query(collection(db, "teams"), where("teamName", "==", name));
    const snapshot = await getDocs(q);
    return !snapshot.empty;
  }

  // Create new team
  async function createTeam(teamName: string): Promise<string> {
    // Check if team name already exists
    const nameExists = await teamNameExists(teamName);
    if (nameExists) {
      throw new Error("A team with this number already exists. Please use a different team number or join the existing team.");
    }

    let teamCode = generateTeamCode();
    
    // Ensure unique team code
    while (await teamCodeExists(teamCode)) {
      teamCode = generateTeamCode();
    }

    // Create team document
    await setDoc(doc(db, "teams", teamCode), {
      teamId: teamCode,
      teamName: teamName,
      createdAt: Date.now(),
    });

    return teamCode;
  }

  // Verify team exists
  async function verifyTeam(teamCode: string): Promise<boolean> {
    return await teamCodeExists(teamCode);
  }

  const handleContinue = async () => {
    setError("");

    if (step === 1) {
      // Validate email/password
      if (!formData.email || !formData.password || !formData.confirmPassword) {
        setError("Please fill in all fields");
        return;
      }
      if (formData.password !== formData.confirmPassword) {
        setError("Passwords do not match");
        return;
      }
      if (formData.password.length < 6) {
        setError("Password must be at least 6 characters");
        return;
      }
      setStep(2);
    } 
    
    else if (step === 2) {
      // Validate name, role, and team action
      if (!formData.name || !formData.role || !formData.teamAction) {
        setError("Please complete all fields");
        return;
      }
      setStep(3);
    } 
    
    else if (step === 3) {
      setLoading(true);
      
      try {
        let teamId = "";
        let isTeamAdmin = false;

        if (formData.teamAction === "create") {
          // Validate team number
          if (!formData.teamName) {
            setError("Please enter a team number");
            setLoading(false);
            return;
          }
          
          // Create new team
          teamId = await createTeam(formData.teamName);
          isTeamAdmin = true;
        } else {
          // Validate team code
          if (!formData.teamNumber) {
            setError("Please enter a team code");
            setLoading(false);
            return;
          }
          
          // Verify team exists
          const exists = await verifyTeam(formData.teamNumber);
          if (!exists) {
            setError("Team code not found. Please check and try again.");
            setLoading(false);
            return;
          }
          
          teamId = formData.teamNumber;
          isTeamAdmin = false;
        }

        // Create user account
        await signUp(
          formData.email,
          formData.password,
          formData.name,
          formData.role as "coach" | "scout",
          teamId,
          isTeamAdmin
        );

        // Redirect to appropriate dashboard
        if (formData.role === "coach") {
          router.push("/coach-dashboard");
        } else {
          router.push("/scout-dashboard");
        }
      } catch (err: any) {
        console.error("Signup error:", err);
        setError(err.message || "Failed to create account. Please try again.");
        setLoading(false);
      }
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* HEADER */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-xl mx-auto mb-4 flex items-center justify-center" style={{ backgroundColor: "#c42221" }}>
            <span className="text-white text-2xl font-bold">CS</span>
          </div>
          <h1 className="text-3xl font-bold mb-2" style={{ color: "#c42221" }}>
            Create Your Account
          </h1>
          <p className="text-gray-600">Step {step} of 3</p>
        </div>

        {/* PROGRESS BAR */}
        <div className="mb-8">
          <div className="flex gap-2">
            <div className={`h-2 flex-1 rounded-full ${step >= 1 ? "bg-red-600" : "bg-gray-200"}`} />
            <div className={`h-2 flex-1 rounded-full ${step >= 2 ? "bg-red-600" : "bg-gray-200"}`} />
            <div className={`h-2 flex-1 rounded-full ${step >= 3 ? "bg-red-600" : "bg-gray-200"}`} />
          </div>
        </div>

        {/* ERROR MESSAGE */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {/* FORM CARD */}
        <div className="bg-white rounded-xl shadow-lg p-8">
          {/* STEP 1: EMAIL & PASSWORD */}
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold mb-4">Account Details</h2>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full border rounded-lg p-3"
                  placeholder="you@example.com"
                  autoComplete="email"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Password
                </label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="w-full border rounded-lg p-3"
                  placeholder="At least 6 characters"
                  autoComplete="new-password"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Confirm Password
                </label>
                <input
                  type="password"
                  value={formData.confirmPassword}
                  onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                  className="w-full border rounded-lg p-3"
                  placeholder="Re-enter password"
                  autoComplete="new-password"
                />
              </div>
            </div>
          )}

          {/* STEP 2: NAME, ROLE & TEAM ACTION */}
          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold mb-4">Your Details</h2>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full border rounded-lg p-3"
                  placeholder="Jordan Smith"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  I am a...
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, role: "scout", teamAction: "join" })}
                    className={`p-4 border-2 rounded-lg font-medium transition-all ${
                      formData.role === "scout"
                        ? "border-red-600 bg-red-50 text-red-600"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <div className="text-2xl mb-1">📝</div>
                    Scout
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, role: "coach" })}
                    className={`p-4 border-2 rounded-lg font-medium transition-all ${
                      formData.role === "coach"
                        ? "border-red-600 bg-red-50 text-red-600"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <div className="text-2xl mb-1">👨‍💼</div>
                    Coach
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Team
                </label>
                {formData.role === "scout" ? (
                  // Scouts can only join teams
                  <div>
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, teamAction: "join" })}
                      className="w-full p-4 border-2 border-red-600 bg-red-50 text-red-600 rounded-lg font-medium"
                    >
                      <div className="text-2xl mb-1">🔗</div>
                      Join Team
                    </button>
                    <p className="text-xs text-gray-500 mt-2">
                      Scouts must join an existing team using a team code from their coach.
                    </p>
                  </div>
                ) : (
                  // Coaches can join or create
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, teamAction: "join" })}
                      className={`p-4 border-2 rounded-lg font-medium transition-all ${
                        formData.teamAction === "join"
                          ? "border-red-600 bg-red-50 text-red-600"
                          : "border-gray-200 hover:border-gray-300"
                      }`}
                    >
                      <div className="text-2xl mb-1">🔗</div>
                      Join Team
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, teamAction: "create" })}
                      className={`p-4 border-2 rounded-lg font-medium transition-all ${
                        formData.teamAction === "create"
                          ? "border-red-600 bg-red-50 text-red-600"
                          : "border-gray-200 hover:border-gray-300"
                      }`}
                    >
                      <div className="text-2xl mb-1">✨</div>
                      Create Team
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STEP 3: TEAM INFO */}
          {step === 3 && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold mb-4">Team Information</h2>
              
              {formData.teamAction === "join" ? (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Team Code
                  </label>
                  <input
                    type="text"
                    value={formData.teamNumber}
                    onChange={(e) => setFormData({ ...formData, teamNumber: e.target.value.toUpperCase() })}
                    className="w-full border rounded-lg p-3 font-mono uppercase"
                    placeholder="ABC123"
                    maxLength={6}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Enter the 6-character code provided by your team admin
                  </p>
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Team Number
                  </label>
                  <input
                    type="text"
                    value={formData.teamName}
                    onChange={(e) => setFormData({ ...formData, teamName: e.target.value })}
                    className="w-full border rounded-lg p-3"
                    placeholder="1234"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    A unique team code will be generated for you
                  </p>
                </div>
              )}
            </div>
          )}

          {/* NAVIGATION BUTTONS */}
          <div className="mt-6 flex gap-3">
            {step > 1 && (
              <button
                onClick={() => setStep(step - 1)}
                disabled={loading}
                className="flex-1 py-3 border border-gray-300 rounded-lg font-semibold hover:bg-gray-50 disabled:opacity-50"
              >
                Back
              </button>
            )}
            <button
              onClick={handleContinue}
              disabled={loading}
              className="flex-1 py-3 rounded-lg text-white font-semibold disabled:opacity-50"
              style={{ backgroundColor: "#c42221" }}
            >
              {loading ? "Creating..." : step === 3 ? "Create Account" : "Continue"}
            </button>
          </div>
        </div>

        {/* LOGIN LINK */}
        <p className="text-center mt-6 text-gray-600">
          Already have an account?{" "}
          <button
            onClick={() => router.push("/login")}
            className="font-semibold hover:underline"
            style={{ color: "#c42221" }}
          >
            Log In
          </button>
        </p>
      </div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <ProtectedRoute requireAuth={false}>
      <SignupContent />
    </ProtectedRoute>
  );
}
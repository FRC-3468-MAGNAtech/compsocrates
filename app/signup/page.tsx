"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { collection, doc, setDoc, getDoc, addDoc } from "firebase/firestore";
import { db } from "@/app/firebase";
import { useAuth } from "@/app/AuthContext";
import { UserCircle, Send } from "lucide-react";
import GoogleSignInButton from "@/app/components/GoogleSignInButton";

export default function SignupPage() {
  const router = useRouter();
  const { signUp } = useAuth();
  const [step, setStep] = useState<"info" | "team">("info");
  const [loading, setLoading] = useState(false);
  const [teamAction, setTeamAction] = useState<"create" | "join" | null>(null);
  const [requestPending, setRequestPending] = useState(false);

  const [formData, setFormData] = useState({
    email: "",
    password: "",
    confirmPassword: "",
    name: "",
    role: "scout" as "scout" | "coach",
    teamCode: "",
    teamName: "",
  });

  async function handleInfoSubmit(e: React.FormEvent) {
    e.preventDefault();
    
    if (formData.password !== formData.confirmPassword) {
      alert("Passwords don't match!");
      return;
    }

    if (formData.password.length < 6) {
      alert("Password must be at least 6 characters");
      return;
    }

    setStep("team");
  }

  async function handleCreateTeam() {
    setLoading(true);
    try {
      // Generate 6-character team code
      const teamCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      
      // Create team in Firestore
      await setDoc(doc(db, "teams", teamCode), {
        teamId: teamCode,
        teamName: formData.teamName,
        createdAt: Date.now(),
      });

      // Create user account
      await signUp(
        formData.email,
        formData.password,
        formData.name,
        formData.role,
        teamCode,
        true // isTeamAdmin
      );

      router.push("/coach-dashboard");
    } catch (error: any) {
      console.error("Signup error:", error);
      alert(error.message || "Failed to create team");
    } finally {
      setLoading(false);
    }
  }

  async function handleJoinTeam() {
    setLoading(true);
    try {
      // Check if team exists
      const teamDoc = await getDoc(doc(db, "teams", formData.teamCode.toUpperCase()));
      
      if (!teamDoc.exists()) {
        alert("Team code not found. Please check and try again.");
        setLoading(false);
        return;
      }

      // Create user account WITHOUT team (teamId will be empty until approved)
      await signUp(
        formData.email,
        formData.password,
        formData.name,
        formData.role,
        "", // Empty teamId - will be set when request is approved
        false
      );

      // Get the newly created user's ID
      const userEmail = formData.email;
      
      // Create team join request
      await addDoc(collection(db, "teamRequests"), {
        teamId: formData.teamCode.toUpperCase(),
        userEmail: userEmail,
        userName: formData.name,
        requestedRole: formData.role,
        status: "pending",
        createdAt: Date.now(),
      });

      setRequestPending(true);
    } catch (error: any) {
      console.error("Join request error:", error);
      alert(error.message || "Failed to send join request");
    } finally {
      setLoading(false);
    }
  }

  if (requestPending) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-md p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Send className="text-yellow-600" size={32} />
          </div>
          <h1 className="text-2xl font-bold mb-2">Request Sent!</h1>
          <p className="text-gray-600 mb-4">
            Your request to join <span className="font-semibold">Team {formData.teamCode}</span> has been sent to the team admin.
          </p>
          <p className="text-sm text-gray-500 mb-6">
            You'll receive an email when your request is approved. You can close this page now.
          </p>
          <button
            onClick={() => router.push("/login")}
            className="px-6 py-2 bg-gray-200 hover:bg-gray-300 rounded-lg font-semibold"
          >
            Go to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-md p-8 max-w-md w-full">
        <div className="text-center mb-6">
          <div
            className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center text-white text-2xl font-bold"
            style={{ backgroundColor: "#c42221" }}
          >
            CS
          </div>
          <h1 className="text-2xl font-bold">Create Account</h1>
          <p className="text-gray-600">Join CompSocrates</p>
        </div>

        {/* STEP 1: ACCOUNT INFO */}
        {step === "info" && (
          <form onSubmit={handleInfoSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full border rounded-lg p-2"
                placeholder="John Smith"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                required
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="w-full border rounded-lg p-2"
                placeholder="john@example.com"
              />
            </div>

            <GoogleSignInButton />
            <div className="text-center my-4 text-gray-500">or</div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input
                type="password"
                required
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className="w-full border rounded-lg p-2"
                placeholder="Min. 6 characters"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
              <input
                type="password"
                required
                value={formData.confirmPassword}
                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                className="w-full border rounded-lg p-2"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Role</label>
              <div className="grid grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, role: "scout" })}
                  className={`p-4 border-2 rounded-lg text-center transition-all ${
                    formData.role === "scout"
                      ? "border-red-600 bg-red-50"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <UserCircle className="mx-auto mb-2" size={32} />
                  <div className="font-semibold">Scout</div>
                  <div className="text-xs text-gray-600">Collect data</div>
                </button>

                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, role: "coach" })}
                  className={`p-4 border-2 rounded-lg text-center transition-all ${
                    formData.role === "coach"
                      ? "border-red-600 bg-red-50"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <UserCircle className="mx-auto mb-2" size={32} />
                  <div className="font-semibold">Coach</div>
                  <div className="text-xs text-gray-600">Manage team</div>
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-3 rounded-lg text-white font-semibold"
              style={{ backgroundColor: "#c42221" }}
            >
              Continue
            </button>
          </form>
        )}

        {/* STEP 2: TEAM SELECTION */}
        {step === "team" && !teamAction && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold mb-4">Team Setup</h2>
            
            <button
              onClick={() => setTeamAction("create")}
              className="w-full p-4 border-2 border-gray-200 rounded-lg hover:border-red-600 hover:bg-red-50 text-left transition-all"
            >
              <div className="font-semibold mb-1">Create New Team</div>
              <div className="text-sm text-gray-600">Start a new team and invite members</div>
            </button>

            <button
              onClick={() => setTeamAction("join")}
              className="w-full p-4 border-2 border-gray-200 rounded-lg hover:border-red-600 hover:bg-red-50 text-left transition-all"
            >
              <div className="font-semibold mb-1">Join Existing Team</div>
              <div className="text-sm text-gray-600">Request to join a team with a code</div>
            </button>

            <button
              onClick={() => setStep("info")}
              className="w-full py-2 text-gray-600 hover:text-gray-800"
            >
              ← Back
            </button>
          </div>
        )}

        {/* CREATE TEAM */}
        {step === "team" && teamAction === "create" && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold mb-4">Create Team</h2>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Team Number</label>
              <input
                type="text"
                required
                value={formData.teamName}
                onChange={(e) => setFormData({ ...formData, teamName: e.target.value })}
                className="w-full border rounded-lg p-2"
                placeholder="1234"
              />
              <p className="text-xs text-gray-500 mt-1">Your FRC team number</p>
            </div>

            <button
              onClick={handleCreateTeam}
              disabled={loading || !formData.teamName}
              className="w-full py-3 rounded-lg text-white font-semibold disabled:opacity-50"
              style={{ backgroundColor: "#c42221" }}
            >
              {loading ? "Creating..." : "Create Team"}
            </button>

            <button
              onClick={() => setTeamAction(null)}
              className="w-full py-2 text-gray-600 hover:text-gray-800"
            >
              ← Back
            </button>
          </div>
        )}

        {/* JOIN TEAM */}
        {step === "team" && teamAction === "join" && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold mb-4">Request to Join Team</h2>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Team Code</label>
              <input
                type="text"
                required
                value={formData.teamCode}
                onChange={(e) => setFormData({ ...formData, teamCode: e.target.value.toUpperCase() })}
                className="w-full border rounded-lg p-2 uppercase font-mono text-lg"
                placeholder="ABC123"
                maxLength={6}
              />
              <p className="text-xs text-gray-500 mt-1">Ask your coach for the 6-character team code</p>
            </div>

            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <p className="text-sm text-yellow-800">
                <strong>Note:</strong> Your request will be sent to the team admin for approval. You'll receive an email when approved.
              </p>
            </div>

            <button
              onClick={handleJoinTeam}
              disabled={loading || formData.teamCode.length !== 6}
              className="w-full py-3 rounded-lg text-white font-semibold disabled:opacity-50"
              style={{ backgroundColor: "#c42221" }}
            >
              {loading ? "Sending Request..." : "Send Join Request"}
            </button>

            <button
              onClick={() => setTeamAction(null)}
              className="w-full py-2 text-gray-600 hover:text-gray-800"
            >
              ← Back
            </button>
          </div>
        )}

        <div className="mt-6 text-center">
          <p className="text-sm text-gray-600">
            Already have an account?{" "}
            <button
              onClick={() => router.push("/login")}
              className="font-semibold"
              style={{ color: "#c42221" }}
            >
              Log In
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
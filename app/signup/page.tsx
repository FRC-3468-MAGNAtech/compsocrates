"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SignupPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    name: "",
    teamAction: "", // "join" or "create"
    teamNumber: "",
    role: "", // "coach" or "scout"
  });

  const handleContinue = () => {
    if (step === 1) {
      // Validate email/password
      if (!formData.email || !formData.password) {
        alert("Please enter email and password");
        return;
      }
      setStep(2);
    } else if (step === 2) {
      // Validate name and team action
      if (!formData.name || !formData.teamAction) {
        alert("Please complete all fields");
        return;
      }
      setStep(3);
    } else if (step === 3) {
      // Validate team number and role
      if (!formData.teamNumber || !formData.role) {
        alert("Please complete all fields");
        return;
      }
      // Here you would normally create the account
      // For now, redirect to dashboard based on role
      if (formData.role === "coach") {
        router.push("/dashboard/coach");
      } else {
        router.push("/dashboard/scout");
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
                  placeholder="••••••••"
                />
                <p className="text-xs text-gray-500 mt-1">Must be at least 8 characters</p>
              </div>

              <div className="pt-4">
                <p className="text-sm text-gray-600 text-center mb-4">
                  Or sign up with
                </p>
                <button className="w-full border-2 border-gray-300 rounded-lg p-3 flex items-center justify-center gap-3 hover:bg-gray-50">
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  <span className="font-medium">Continue with Google</span>
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: NAME & TEAM ACTION */}
          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold mb-4">Personal Information</h2>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Your Name
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full border rounded-lg p-3"
                  placeholder="John Doe"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  What would you like to do?
                </label>
                <div className="space-y-3">
                  <button
                    onClick={() => setFormData({ ...formData, teamAction: "join" })}
                    className={`w-full p-4 rounded-lg border-2 text-left transition-colors ${
                      formData.teamAction === "join"
                        ? "border-red-600 bg-red-50"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                        formData.teamAction === "join" ? "border-red-600" : "border-gray-300"
                      }`}>
                        {formData.teamAction === "join" && (
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: "#c42221" }} />
                        )}
                      </div>
                      <div className="flex-1">
                        <p className="font-semibold">Join an Existing Team</p>
                        <p className="text-sm text-gray-600">Join a team using an invite code</p>
                      </div>
                    </div>
                  </button>

                  <button
                    onClick={() => setFormData({ ...formData, teamAction: "create" })}
                    className={`w-full p-4 rounded-lg border-2 text-left transition-colors ${
                      formData.teamAction === "create"
                        ? "border-red-600 bg-red-50"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                        formData.teamAction === "create" ? "border-red-600" : "border-gray-300"
                      }`}>
                        {formData.teamAction === "create" && (
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: "#c42221" }} />
                        )}
                      </div>
                      <div className="flex-1">
                        <p className="font-semibold">Create a New Team</p>
                        <p className="text-sm text-gray-600">Set up your FRC team's scouting system</p>
                      </div>
                    </div>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: TEAM & ROLE */}
          {step === 3 && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold mb-4">Team Details</h2>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {formData.teamAction === "join" ? "Team Invite Code" : "FRC Team Number"}
                </label>
                <input
                  type="text"
                  value={formData.teamNumber}
                  onChange={(e) => setFormData({ ...formData, teamNumber: e.target.value })}
                  className="w-full border rounded-lg p-3"
                  placeholder={formData.teamAction === "join" ? "ABC123" : "1234"}
                />
                {formData.teamAction === "create" && (
                  <p className="text-xs text-gray-500 mt-1">Enter your official FRC team number</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  What's your role?
                </label>
                <div className="space-y-3">
                  <button
                    onClick={() => setFormData({ ...formData, role: "coach" })}
                    className={`w-full p-4 rounded-lg border-2 text-left transition-colors ${
                      formData.role === "coach"
                        ? "border-red-600 bg-red-50"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                        formData.role === "coach" ? "border-red-600" : "border-gray-300"
                      }`}>
                        {formData.role === "coach" && (
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: "#c42221" }} />
                        )}
                      </div>
                      <div className="flex-1">
                        <p className="font-semibold">Coach / Team Lead</p>
                        <p className="text-sm text-gray-600">Manage team, build forms, view all analytics</p>
                      </div>
                    </div>
                  </button>

                  <button
                    onClick={() => setFormData({ ...formData, role: "scout" })}
                    className={`w-full p-4 rounded-lg border-2 text-left transition-colors ${
                      formData.role === "scout"
                        ? "border-red-600 bg-red-50"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                        formData.role === "scout" ? "border-red-600" : "border-gray-300"
                      }`}>
                        {formData.role === "scout" && (
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: "#c42221" }} />
                        )}
                      </div>
                      <div className="flex-1">
                        <p className="font-semibold">Scout</p>
                        <p className="text-sm text-gray-600">Collect match data and view analytics</p>
                      </div>
                    </div>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* NAVIGATION BUTTONS */}
          <div className="flex gap-3 mt-6">
            {step > 1 && (
              <button
                onClick={() => setStep(step - 1)}
                className="px-6 py-3 rounded-lg border border-gray-300 hover:bg-gray-50 font-medium"
              >
                Back
              </button>
            )}
            <button
              onClick={handleContinue}
              className="flex-1 px-6 py-3 rounded-lg text-white font-semibold"
              style={{ backgroundColor: "#c42221" }}
            >
              {step === 3 ? "Create Account" : "Continue"}
            </button>
          </div>

          {/* LOGIN LINK */}
          {step === 1 && (
            <p className="text-sm text-gray-600 text-center mt-4">
              Already have an account?{" "}
              <button
                onClick={() => router.push("/login")}
                className="font-semibold"
                style={{ color: "#c42221" }}
              >
                Log in
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
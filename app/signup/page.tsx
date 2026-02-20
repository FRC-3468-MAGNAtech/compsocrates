// FILE: app/signup/page.tsx
// COMPLETE REWRITE - Team join requests instead of auto-join

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { collection, addDoc, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "@/app/firebase";
import { useAuth } from "@/app/AuthContext";
import GoogleSignInButton from "@/app/components/GoogleSignInButton";

async function resolveTeamCode(code: string): Promise<string | null> {
  const normalized = code.trim();
  if (!normalized) return null;
  const attempts = [normalized, normalized.toUpperCase(), normalized.toLowerCase()];
  for (const attempt of attempts) {
    const teamDoc = await getDoc(doc(db, "teams", attempt));
    if (teamDoc.exists()) return attempt;
  }
  return null;
}

async function waitForCurrentUid(timeoutMs = 5000): Promise<string | null> {
  if (auth.currentUser?.uid) return auth.currentUser.uid;
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      resolve(auth.currentUser?.uid || null);
    }, timeoutMs);
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      if (nextUser?.uid) {
        clearTimeout(timeout);
        unsubscribe();
        resolve(nextUser.uid);
      }
    });
  });
}

async function hasPendingJoinRequest(userId: string, teamId: string): Promise<boolean> {
  const normalizedUserId = userId.trim();
  const normalizedTeamId = teamId.trim().toLowerCase();
  if (!normalizedUserId || !normalizedTeamId) return false;

  const requestsQuery = query(collection(db, "teamJoinRequests"), where("userId", "==", normalizedUserId));
  const requestsSnap = await getDocs(requestsQuery);

  return requestsSnap.docs.some((docSnap) => {
    const data = docSnap.data() as Record<string, unknown>;
    const status = String(data.status || "");
    const requestTeamId = String(data.teamId || "").toLowerCase();
    return status === "pending" && requestTeamId === normalizedTeamId;
  });
}

async function createTeamJoinRequestWithFallback(input: {
  userId: string;
  userEmail: string;
  userName: string;
  requestedRole: "scout" | "coach";
  teamId: string;
}) {
  const createdAt = Date.now();
  const normalizedEmail = input.userEmail.trim().toLowerCase();
  const fullPayload = {
    userId: input.userId,
    userEmail: input.userEmail,
    userEmailLower: normalizedEmail,
    userName: input.userName,
    userRole: input.requestedRole,
    requestedRole: input.requestedRole,
    teamId: input.teamId,
    status: "pending",
    createdAt,
  };
  const fallbackPayloads: Array<Record<string, unknown>> = [
    fullPayload,
    {
      userId: input.userId,
      userEmail: input.userEmail,
      userEmailLower: normalizedEmail,
      userName: input.userName,
      requestedRole: input.requestedRole,
      teamId: input.teamId,
      status: "pending",
      createdAt,
    },
    {
      userId: input.userId,
      userName: input.userName,
      requestedRole: input.requestedRole,
      teamId: input.teamId,
      status: "pending",
      createdAt,
    },
    {
      userId: input.userId,
      role: input.requestedRole,
      teamId: input.teamId,
      status: "pending",
      createdAt,
    },
    {
      userId: input.userId,
      teamId: input.teamId,
      status: "pending",
      createdAt,
    },
  ];

  let lastError: unknown = null;
  for (const payload of fallbackPayloads) {
    try {
      await addDoc(collection(db, "teamJoinRequests"), payload);
      return;
    } catch (error) {
      lastError = error;
      const message = String((error as { message?: string })?.message || "").toLowerCase();
      const isPermissionLike =
        message.includes("permission") ||
        message.includes("insufficient") ||
        message.includes("missing or insufficient");
      if (!isPermissionLike) {
        throw error;
      }
    }
  }

  throw lastError || new Error("Unable to create team join request.");
}

export default function SignupPage() {
  const router = useRouter();
  const { signUp } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<"scout" | "coach">("scout");
  const [joinCode, setJoinCode] = useState("");
  const [isCreatingTeam, setIsCreatingTeam] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }

    if (!isCreatingTeam && !joinCode) {
      setError("Please enter a team join code");
      return;
    }

    setLoading(true);

    try {
      if (isCreatingTeam) {
        // Create new team
        await signUp(email, password, displayName, role, joinCode, true);
        alert("Account created! Please verify your email to continue.");
        router.push("/dashboard");
      } else {
        // Verify team exists
        const resolvedTeamCode = await resolveTeamCode(joinCode);
        if (!resolvedTeamCode) {
          setError("Team not found. Please check the join code.");
          setLoading(false);
          return;
        }

        // Create user account (without team yet)
        await signUp(email, password, displayName, role, "", false);
        const resolvedUid = await waitForCurrentUid();
        if (!resolvedUid) {
          throw new Error("Could not verify account session. Please sign in and send the join request from Dashboard.");
        }
        const hasPending = await hasPendingJoinRequest(resolvedUid, resolvedTeamCode);
        if (hasPending) {
          alert("You already have a pending request for this team.");
          router.push("/dashboard");
          return;
        }

        // Create join request
        await createTeamJoinRequestWithFallback({
          userId: resolvedUid,
          userEmail: email,
          userName: displayName,
          requestedRole: role,
          teamId: resolvedTeamCode,
        });

        alert("Account created! Please verify your email and wait for team admin approval.");
        router.push("/dashboard");
      }
    } catch (error: any) {
      console.error("Signup error:", error);
      setError(error.message || "An error occurred during signup");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-8">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2" style={{ color: "#c42221" }}>
            CompSocrates
          </h1>
          <p className="text-gray-600">Create your account</p>
        </div>

        {error && (
          <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-6 rounded">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        <form onSubmit={handleSignup} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Full Name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full border rounded-lg p-3"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border rounded-lg p-3"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border rounded-lg p-3"
              minLength={6}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Confirm Password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full border rounded-lg p-3"
              minLength={6}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Role
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "scout" | "coach")}
              className="w-full border rounded-lg p-3"
            >
              <option value="scout">Scout</option>
              <option value="coach">Coach</option>
            </select>
          </div>

          <div>
            <label className="flex items-center gap-2 cursor-pointer mb-4">
              <input
                type="checkbox"
                checked={isCreatingTeam}
                onChange={(e) => setIsCreatingTeam(e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-sm font-medium text-gray-700">
                Create a new team
              </span>
            </label>

            <label className="block text-sm font-medium text-gray-700 mb-2">
              {isCreatingTeam ? "Team ID (your choice)" : "Team Join Code"}
            </label>
            <input
              type="text"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              className="w-full border rounded-lg p-3"
              placeholder={isCreatingTeam ? "e.g., team3468" : "Ask your team admin"}
              required
            />
            {!isCreatingTeam && (
              <p className="text-xs text-gray-500 mt-1">
                You'll need admin approval to join the team
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-lg text-white font-semibold disabled:opacity-50"
            style={{ backgroundColor: "#c42221" }}
          >
            {loading ? "Creating Account..." : "Sign Up"}
          </button>
        </form>

        <div className="my-6 flex items-center gap-4">
          <div className="flex-1 border-t border-gray-300"></div>
          <span className="text-sm text-gray-500">OR</span>
          <div className="flex-1 border-t border-gray-300"></div>
        </div>
        <GoogleSignInButton />

        <p className="text-center text-sm text-gray-600 mt-6">
          Already have an account?{" "}
          <Link href="/login" className="font-semibold hover:underline" style={{ color: "#c42221" }}>
            Sign In
          </Link>
        </p>
      </div>
    </div>
  );
}

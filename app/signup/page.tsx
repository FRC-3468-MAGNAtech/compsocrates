// FILE: app/signup/page.tsx
// COMPLETE REWRITE - Team join requests instead of auto-join

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { addDoc, collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { useAuth } from "@/app/AuthContext";
import GoogleSignInButton from "@/app/components/GoogleSignInButton";
import { deriveJoinRequestName } from "@/app/utils/joinRequestDisplay";
import { TEAM_ROLES, TeamRole, getRoleLabel } from "@/app/utils/roles";
import { auth, db } from "@/app/firebase";
import { updateProfile } from "firebase/auth";
import { setSecureUserDoc } from "@/app/utils/secureUserDoc";
import { getDashboardRoute } from "@/app/utils/dashboardRoute";

async function teamCodeExists(teamCode: string): Promise<"exists" | "missing" | "unknown"> {
  const normalizedCode = teamCode.trim().toUpperCase();
  if (!normalizedCode) return "missing";
  try {
    const response = await fetch(`/api/team-label?teamCode=${encodeURIComponent(normalizedCode)}`, { cache: "no-store" });
    if (!response.ok) return "unknown";
    const payload = (await response.json()) as { exists?: boolean; verified?: boolean };
    if (!payload.verified) return "unknown";
    return payload.exists ? "exists" : "missing";
  } catch {
    return "unknown";
  }
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
  requestedRole: TeamRole;
  teamId: string;
}) {
  const createdAt = Date.now();
  const normalizedEmail = input.userEmail.trim().toLowerCase();
  const resolvedUserName = deriveJoinRequestName({
    userName: input.userName,
    userEmail: input.userEmail,
    userId: input.userId,
  });
  const fullPayload = {
    userId: input.userId,
    userEmail: input.userEmail,
    userEmailLower: normalizedEmail,
    userName: resolvedUserName,
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
      userName: resolvedUserName,
      requestedRole: input.requestedRole,
      teamId: input.teamId,
      status: "pending",
      createdAt,
    },
    {
      userId: input.userId,
      userName: resolvedUserName,
      requestedRole: input.requestedRole,
      teamId: input.teamId,
      status: "pending",
      createdAt,
    },
    {
      userId: input.userId,
      userName: resolvedUserName,
      role: input.requestedRole,
      teamId: input.teamId,
      status: "pending",
      createdAt,
    },
    {
      userId: input.userId,
      userName: resolvedUserName,
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
      if (!isPermissionLike) throw error;
    }
  }
  throw lastError || new Error("Unable to create team join request.");
}

export default function SignupPage() {
  const router = useRouter();
  const { signUp, user } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [role, setRole] = useState<TeamRole>("match-scout");
  const [joinCode, setJoinCode] = useState("");
  const [isCreatingTeam, setIsCreatingTeam] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [isGoogleSignup, setIsGoogleSignup] = useState(false);
  const [googleUserReady, setGoogleUserReady] = useState(false);

  useEffect(() => {
    const currentUser = user || auth.currentUser;
    if (!currentUser) {
      if (typeof window !== "undefined") {
        const params = new URLSearchParams(window.location.search);
        if (params.get("google") === "1") {
          setError("Please sign in with Google again to complete your profile.");
        }
      }
      return;
    }
    const isGoogleUser = currentUser.providerData.some((provider) => provider.providerId === "google.com");
    if (!isGoogleUser) return;
    setIsGoogleSignup(true);
    setGoogleUserReady(true);
    setEmail(currentUser.email || "");
    const displayName = currentUser.displayName || "";
    if (displayName && !firstName && !lastName) {
      const parts = displayName.trim().split(/\s+/);
      setFirstName(parts[0] || "");
      setLastName(parts.slice(1).join(" "));
    }
    void (async () => {
      const userDoc = await getDoc(doc(db, "users", currentUser.uid));
      if (userDoc.exists()) {
        const data = userDoc.data() as { profileComplete?: boolean };
        if (data.profileComplete !== false) {
          router.push(getDashboardRoute(userDoc.data() as { role?: string; roles?: string[]; teamId?: string } | null));
        }
      }
    })();
  }, [firstName, lastName, router, user]);

  function savePendingJoinDraft(teamId: string, requestedRole: TeamRole, emailValue: string, displayName: string) {
    if (typeof window === "undefined") return;
    localStorage.setItem(
      "pending-join-request",
      JSON.stringify({
        teamId,
        requestedRole,
        userEmail: emailValue,
        userName: displayName,
        createdAt: Date.now(),
      })
    );
  }

  function toFriendlyAuthError(message: string) {
    const lower = message.toLowerCase();
    if (lower.includes("email-already-in-use")) return "That email is already in use. Try logging in instead.";
    if (lower.includes("invalid-email")) return "That email address is invalid.";
    if (lower.includes("weak-password")) return "Password is too weak. Use 8+ chars with a capital letter, number, and symbol.";
    if (lower.includes("network-request-failed")) return "Network error. Check connection and try again.";
    if (lower.includes("missing or insufficient permissions")) return "Permission check failed. Please continue; your join request will be sent after login.";
    if (lower.includes("popup")) return "Google popup was blocked or closed. Enable popups and try again.";
    return message || "Unable to create account right now.";
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const displayName = `${firstName.trim()} ${lastName.trim()}`.trim();
    if (!displayName) {
      setError("Please enter your first and last name.");
      return;
    }

    if (!isGoogleSignup) {
      const passwordStrong =
        password.length >= 8 &&
        /[A-Z]/.test(password) &&
        /[0-9]/.test(password) &&
        /[^A-Za-z0-9]/.test(password);
      if (!passwordStrong) {
        setError("Password must be 8+ chars and include a capital letter, number, and symbol.");
        return;
      }

      if (password !== confirmPassword) {
        setError("Passwords don't match");
        return;
      }
    }

    if (!isCreatingTeam && !joinCode) {
      setError("Please enter a team join code");
      return;
    }

    setLoading(true);

    try {
      if (isGoogleSignup) {
        if (!googleUserReady || !auth.currentUser) {
          setError("Please sign in with Google again.");
          setLoading(false);
          return;
        }
        if (isCreatingTeam) {
          setError("Creating a team with Google sign-in is not supported. Use email/password for team creation.");
          setLoading(false);
          return;
        }
        const requestedTeamCode = joinCode.trim().toUpperCase();
        if (!requestedTeamCode) {
          setError("Please enter a team join code.");
          setLoading(false);
          return;
        }
        const exists = await teamCodeExists(requestedTeamCode);
        if (exists === "missing") {
          setError(`Team code "${requestedTeamCode}" does not exist. Please check with your team admin.`);
          setLoading(false);
          return;
        }
        if (exists === "unknown") {
          setError("Unable to verify that team code right now. Please try again in a moment.");
          setLoading(false);
          return;
        }

        await updateProfile(auth.currentUser, { displayName });
        await setSecureUserDoc(
          auth.currentUser.uid,
          {
            uid: auth.currentUser.uid,
            email: auth.currentUser.email || email,
            displayName,
            role,
            roles: [role],
            teamId: "",
            isTeamAdmin: false,
            profileVisibility: "team",
            bio: "",
            photoURL: auth.currentUser.photoURL || "",
            profileComplete: true,
            createdAt: Date.now(),
          },
          false
        );

        const alreadyPending = await hasPendingJoinRequest(auth.currentUser.uid, requestedTeamCode);
        if (alreadyPending) {
          alert("You already asked to join that team and your request is still pending.");
          router.push(`/dashboard?requestSubmitted=1&team=${encodeURIComponent(requestedTeamCode)}`);
          return;
        }
        try {
          await createTeamJoinRequestWithFallback({
            userId: auth.currentUser.uid,
            userEmail: auth.currentUser.email || email,
            userName: displayName,
            requestedRole: role,
            teamId: requestedTeamCode,
          });
          alert("Profile saved! Join request sent.");
          router.push(`/dashboard?requestSubmitted=1&team=${encodeURIComponent(requestedTeamCode)}`);
          return;
        } catch {
          savePendingJoinDraft(requestedTeamCode, role, auth.currentUser.email || email, displayName);
          alert("Profile saved! Your join request will be sent automatically after login.");
          router.push(`/dashboard?autoJoin=1&team=${encodeURIComponent(requestedTeamCode)}&role=${encodeURIComponent(role)}`);
          return;
        }
      }

      if (isCreatingTeam) {
        // Create new team
        await signUp(email, password, displayName, role, joinCode.trim().toUpperCase(), true);
        alert("Account created! Please verify your email to continue.");
        router.push("/dashboard");
      } else {
        const requestedTeamCode = joinCode.trim().toUpperCase();
        if (!requestedTeamCode) {
          setError("Please enter a team join code.");
          setLoading(false);
          return;
        }
        const exists = await teamCodeExists(requestedTeamCode);
        if (exists === "missing") {
          setError(`Team code "${requestedTeamCode}" does not exist. Please check with your team admin.`);
          setLoading(false);
          return;
        }
        if (exists === "unknown") {
          setError("Unable to verify that team code right now. Please try again in a moment.");
          setLoading(false);
          return;
        }

        // Create user account (without team yet)
        const newUid = await signUp(email, password, displayName, role, "", false);
        const alreadyPending = await hasPendingJoinRequest(newUid, requestedTeamCode);
        if (alreadyPending) {
          alert("You already asked to join that team and your request is still pending.");
          router.push(`/dashboard?requestSubmitted=1&team=${encodeURIComponent(requestedTeamCode)}`);
          return;
        }
        try {
          await createTeamJoinRequestWithFallback({
            userId: newUid,
            userEmail: email,
            userName: displayName,
            requestedRole: role,
            teamId: requestedTeamCode,
          });
          alert("Account created! Join request sent. Please verify your email.");
          router.push(`/dashboard?requestSubmitted=1&team=${encodeURIComponent(requestedTeamCode)}`);
          return;
        } catch {
          savePendingJoinDraft(requestedTeamCode, role, email, displayName);
          alert("Account created! Please verify your email. Your join request will be sent automatically after login.");
          router.push(`/dashboard?autoJoin=1&team=${encodeURIComponent(requestedTeamCode)}&role=${encodeURIComponent(role)}`);
        }
      }
    } catch (error: unknown) {
      console.error("Signup error:", error);
      const message = error instanceof Error ? error.message : "An error occurred during signup";
      setError(toFriendlyAuthError(message));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-8">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2" style={{ color: "var(--primary-color)" }}>
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
              First Name
            </label>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="w-full border rounded-lg p-3"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Last Name
            </label>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
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
              disabled={isGoogleSignup}
              className="w-full border rounded-lg p-3"
              required
            />
          </div>

          {!isGoogleSignup && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full border rounded-lg p-3"
                  minLength={8}
                  required
                />
                <p className="text-xs text-gray-500 mt-1">Must be 8+ chars with a capital letter, number, and symbol.</p>
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
                  minLength={8}
                  required
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Role
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as TeamRole)}
              className="w-full border rounded-lg p-3"
            >
              {TEAM_ROLES.map((teamRole) => (
                <option key={teamRole} value={teamRole}>
                  {getRoleLabel(teamRole)}
                </option>
              ))}
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
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              className="w-full border rounded-lg p-3"
              placeholder={isCreatingTeam ? "e.g., team3468" : "Ask your team admin"}
              autoCapitalize="characters"
              required
            />
            {!isCreatingTeam && (
              <p className="text-xs text-gray-500 mt-1">
                You&apos;ll need admin approval to join the team
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-lg text-white font-semibold disabled:opacity-50"
            style={{ backgroundColor: "var(--primary-color)" }}
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
          <Link href="/login" className="font-semibold hover:underline" style={{ color: "var(--primary-color)" }}>
            Sign In
          </Link>
        </p>

        <p className="text-center text-xs text-gray-500 mt-4">
          By creating an account, you agree to our{" "}
          <Link href="/terms-of-service" className="underline hover:text-gray-700">
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link href="/privacy-policy" className="underline hover:text-gray-700">
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </div>
  );
}


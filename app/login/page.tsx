// FILE: app/login/page.tsx
// COMPLETE REWRITE - Google Sign-In added

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signInWithPopup, GoogleAuthProvider } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/app/firebase";
import { useAuth } from "@/app/AuthContext";
import { setSecureUserDoc } from "@/app/utils/secureUserDoc";
import { getDashboardRoute } from "@/app/utils/dashboardRoute";

export default function LoginPage() {
  const router = useRouter();
  const { signIn } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const googleAuthAvailable = false;

  function toFriendlyAuthError(message: string) {
    const lower = message.toLowerCase();
    if (lower.includes("invalid-credential") || lower.includes("wrong-password") || lower.includes("user-not-found")) {
      return "Email or password is incorrect.";
    }
    if (lower.includes("too-many-requests")) return "Too many attempts. Try again in a few minutes.";
    if (lower.includes("network-request-failed")) return "Network error. Check connection and try again.";
    if (lower.includes("popup")) return "Google popup was blocked or closed. Enable popups and try again.";
    return message || "Login failed.";
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await signIn(email, password);
      const currentUser = auth.currentUser;
      if (!currentUser) {
        router.push("/dashboard");
        return;
      }
      const userDoc = await getDoc(doc(db, "users", currentUser.uid));
      const data = userDoc.exists() ? userDoc.data() : null;
      router.push(getDashboardRoute(data as { role?: string; roles?: string[]; teamId?: string } | null));
    } catch (error: unknown) {
      console.error("Login error:", error);
      const message = error instanceof Error ? error.message : "Invalid email or password";
      setError(toFriendlyAuthError(message));
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleSignIn() {
    setError("");
    setLoading(true);

    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      const result = await signInWithPopup(auth, provider);
      const user = result.user;

      // Check if user exists in Firestore
      const userDoc = await getDoc(doc(db, "users", user.uid));
      
      if (!userDoc.exists()) {
        // New user - redirect to complete profile
        await setSecureUserDoc(user.uid, {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName || user.email?.split('@')[0] || "User",
          photoURL: user.photoURL || "",
          role: "match-scout",
          roles: ["match-scout"],
          teamId: "",
          isTeamAdmin: false,
          createdAt: Date.now()
        });

        router.push("/dashboard");
      } else {
        // Existing user - check if they have a team
        const userData = userDoc.data();
        router.push(getDashboardRoute(userData));
      }
    } catch (error: unknown) {
      console.error("Google sign-in error:", error);
      const message = error instanceof Error ? error.message : "Failed to sign in with Google";
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
          <p className="text-gray-600">Sign in to your account</p>
        </div>

        {error && (
          <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-6 rounded">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
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
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-lg text-white font-semibold disabled:opacity-50"
            style={{ backgroundColor: "var(--primary-color)" }}
          >
            {loading ? "Signing In..." : "Sign In"}
          </button>
        </form>

        <div className="my-6 flex items-center gap-4">
          <div className="flex-1 border-t border-gray-300"></div>
          <span className="text-sm text-gray-500">OR</span>
          <div className="flex-1 border-t border-gray-300"></div>
        </div>

        <button
          onClick={handleGoogleSignIn}
          disabled={loading || !googleAuthAvailable}
          title={!googleAuthAvailable ? "Google Sign-In is currently unavailable" : undefined}
          className={`w-full py-3 rounded-lg border-2 border-gray-300 font-semibold flex items-center justify-center gap-3 disabled:opacity-50 ${
            googleAuthAvailable ? "hover:bg-gray-50" : "bg-gray-100 text-gray-500 cursor-not-allowed"
          }`}
        >
          <svg width="20" height="20" viewBox="0 0 20 20">
            <path fill="#4285F4" d="M19.6 10.23c0-.82-.1-1.42-.25-2.05H10v3.72h5.5c-.15.96-.74 2.31-2.04 3.22v2.45h3.16c1.89-1.73 2.98-4.3 2.98-7.34z"/>
            <path fill="#34A853" d="M13.46 15.13c-.83.59-1.96 1-3.46 1-2.64 0-4.88-1.74-5.68-4.15H1.07v2.52C2.72 17.75 6.09 20 10 20c2.7 0 4.96-.89 6.62-2.42l-3.16-2.45z"/>
            <path fill="#FBBC05" d="M3.99 10c0-.69.12-1.35.32-1.97V5.51H1.07A9.973 9.973 0 000 10c0 1.61.39 3.14 1.07 4.49l3.24-2.52c-.2-.62-.32-1.28-.32-1.97z"/>
            <path fill="#EA4335" d="M10 3.88c1.88 0 3.13.81 3.85 1.48l2.84-2.76C14.96.99 12.7 0 10 0 6.09 0 2.72 2.25 1.07 5.51l3.24 2.52C5.12 5.62 7.36 3.88 10 3.88z"/>
          </svg>
          Continue with Google (Unavailable)
        </button>

        <p className="text-center text-sm text-gray-600 mt-6">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="font-semibold hover:underline" style={{ color: "var(--primary-color)" }}>
            Sign Up
          </Link>
        </p>

        <p className="text-center text-xs text-gray-500 mt-4">
          By continuing, you agree to our{" "}
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


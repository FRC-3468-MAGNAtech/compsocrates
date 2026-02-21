"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/app/AuthContext";
import { sendEmailVerification } from "firebase/auth";
import { useRouter } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/app/firebase";
import { getDashboardRoute } from "@/app/utils/dashboardRoute";

export default function VerifyEmailPage() {
  const { user } = useAuth();
  const [sending, setSending] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const router = useRouter();

  useEffect(() => {
    async function routeVerifiedUser() {
      if (!user?.emailVerified) return;
      const userDoc = await getDoc(doc(db, "users", user.uid));
      const userData = userDoc.exists() ? userDoc.data() : null;
      router.push(getDashboardRoute(userData as { role?: string; roles?: string[]; teamId?: string } | null));
    }
    routeVerifiedUser();
  }, [user?.emailVerified, user?.uid, router]);

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  async function handleResend() {
    if (!user || countdown > 0) return;

    setSending(true);
    try {
      await sendEmailVerification(user);
      alert("Verification email sent!");
      setCountdown(60); // 60 second cooldown
    } catch (error: any) {
      alert(error.message || "Error sending email");
    } finally {
      setSending(false);
    }
  }

  async function handleCheckVerification() {
    if (!user) return;

    await user.reload();
    if (user.emailVerified) {
      const userDoc = await getDoc(doc(db, "users", user.uid));
      const userData = userDoc.exists() ? userDoc.data() : null;
      router.push(getDashboardRoute(userData as { role?: string; roles?: string[]; teamId?: string } | null));
    } else {
      alert("Email not verified yet. Please check your inbox.");
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full">
        <div className="text-center mb-6">
          <div className="text-6xl mb-4">📧</div>
          <h1 className="text-2xl font-bold mb-2">Verify Your Email</h1>
          <p className="text-gray-600">
            We sent a verification email to:
          </p>
          <p className="font-semibold text-lg mt-2">{user?.email}</p>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <h3 className="font-semibold mb-2">Next Steps:</h3>
          <ol className="text-sm text-gray-700 space-y-1 list-decimal list-inside">
            <li>Check your email inbox</li>
            <li>Click the verification link</li>
            <li>Return here and click "I've Verified"</li>
          </ol>
        </div>

        <button
          onClick={handleCheckVerification}
          className="w-full py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 font-semibold mb-3"
        >
          I've Verified My Email
        </button>

        <button
          onClick={handleResend}
          disabled={sending || countdown > 0}
          className="w-full py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {sending ? "Sending..." : countdown > 0 ? `Resend in ${countdown}s` : "Resend Verification Email"}
        </button>

        <p className="text-center text-sm text-gray-500 mt-4">
          Didn't receive the email? Check your spam folder.
        </p>
      </div>
    </div>
  );
}

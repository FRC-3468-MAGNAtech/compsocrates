"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });

  const handleLogin = () => {
    // Validate
    if (!formData.email || !formData.password) {
      alert("Please enter email and password");
      return;
    }

    // TODO: Add actual Firebase authentication here
    // For now, just redirect to a default dashboard
    // In production, you'd check the user's role and redirect accordingly
    router.push("/dashboard/coach"); // or /dashboard/scout based on user role
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
            Welcome Back
          </h1>
          <p className="text-gray-600">Log in to your CompSocrates account</p>
        </div>

        {/* FORM CARD */}
        <div className="bg-white rounded-xl shadow-lg p-8">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email Address
              </label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
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
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                className="w-full border rounded-lg p-3"
                placeholder="••••••••"
              />
            </div>

            <div className="flex items-center justify-between text-sm">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="rounded" />
                <span className="text-gray-600">Remember me</span>
              </label>
              <button className="font-semibold" style={{ color: "#c42221" }}>
                Forgot password?
              </button>
            </div>

            <button
              onClick={handleLogin}
              className="w-full py-3 rounded-lg text-white font-semibold"
              style={{ backgroundColor: "#c42221" }}
            >
              Log In
            </button>

            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-gray-500">Or continue with</span>
              </div>
            </div>

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

          {/* SIGNUP LINK */}
          <p className="text-sm text-gray-600 text-center mt-6">
            Don't have an account?{" "}
            <button
              onClick={() => router.push("/signup")}
              className="font-semibold"
              style={{ color: "#c42221" }}
            >
              Sign up
            </button>
          </p>
        </div>

        {/* BACK TO HOME */}
        <div className="text-center mt-6">
          <button
            onClick={() => router.push("/")}
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            ← Back to home
          </button>
        </div>
      </div>
    </div>
  );
}
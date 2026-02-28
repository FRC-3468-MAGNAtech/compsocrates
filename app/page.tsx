"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/app/AuthContext";
import { getDashboardRoute } from "@/app/utils/dashboardRoute";

export default function LandingPage() {
  const router = useRouter();
  const { user, userData } = useAuth();

  // Optional: Auto-redirect logged-in users (commented out by default)
  // useEffect(() => {
  //   if (user && userData) {
  //     const dashboard = userData.role === "coach" ? "/coach-dashboard" : "/scout-dashboard";
  //     router.push(dashboard);
  //   }
  // }, [user, userData, router]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      {/* NAVIGATION */}
      <nav className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: "var(--primary-color)" }}>
              <span className="text-white text-xl font-bold">CS</span>
            </div>
            <h1 className="text-2xl font-bold" style={{ color: "var(--primary-color)" }}>
              CompSocrates
            </h1>
          </div>
          <div className="flex gap-3">
            {user && userData ? (
              <button
                onClick={() => router.push(getDashboardRoute(userData))}
                className="px-4 py-2 rounded-lg text-white font-medium"
                style={{ backgroundColor: "var(--primary-color)" }}
              >
                Dashboard
              </button>
            ) : (
              <>
                <button
                  onClick={() => router.push("/login")}
                  className="px-4 py-2 rounded-lg border border-gray-300 hover:bg-gray-50 font-medium"
                >
                  Log In
                </button>
                <button
                  onClick={() => router.push("/signup")}
                  className="px-4 py-2 rounded-lg text-white font-medium"
                  style={{ backgroundColor: "var(--primary-color)" }}
                >
                  Get Started
                </button>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* HERO SECTION */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="text-center max-w-3xl mx-auto">
          <h2 className="text-5xl font-bold mb-6" style={{ color: "var(--primary-color)" }}>
            Strategic Scouting for FRC Teams
          </h2>
          <p className="text-xl text-gray-600 mb-8">
            CompSocrates is the modern scouting platform that helps FIRST Robotics Competition teams make data-driven decisions. Track performance, analyze trends, and dominate the competition.
          </p>
          <button
            onClick={() => router.push("/signup")}
            className="px-8 py-4 rounded-lg text-white font-semibold text-lg shadow-lg hover:shadow-xl transition-shadow"
            style={{ backgroundColor: "var(--primary-color)" }}
          >
            Start Scouting Today
          </button>
        </div>
      </div>

      {/* FEATURES GRID */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <h3 className="text-3xl font-bold text-center mb-12">Why Teams Choose CompSocrates</h3>
        
        <div className="grid md:grid-cols-3 gap-8">
          {/* Feature 1 */}
          <div className="bg-white rounded-xl shadow-md p-6 hover:shadow-lg transition-shadow">
            <div className="w-12 h-12 rounded-lg mb-4 flex items-center justify-center" style={{ backgroundColor: "var(--primary-color)" }}>
              <span className="text-white text-sm font-bold">RT</span>
            </div>
            <h4 className="text-xl font-semibold mb-3">Real-Time Analytics</h4>
            <p className="text-gray-600">
              Track team performance instantly with live data collection during matches. View detailed breakdowns, averages, and rankings as the competition unfolds.
            </p>
          </div>

          {/* Feature 2 */}
          <div className="bg-white rounded-xl shadow-md p-6 hover:shadow-lg transition-shadow">
            <div className="w-12 h-12 rounded-lg mb-4 flex items-center justify-center" style={{ backgroundColor: "var(--primary-color)" }}>
              <span className="text-white text-sm font-bold">M</span>
            </div>
            <h4 className="text-xl font-semibold mb-3">Mobile-First Design</h4>
            <p className="text-gray-600">
              Scout from anywhere with our responsive interface. Works seamlessly on phones, tablets, and laptops - perfect for the chaotic environment of competitions.
            </p>
          </div>

          {/* Feature 3 */}
          <div className="bg-white rounded-xl shadow-md p-6 hover:shadow-lg transition-shadow">
            <div className="w-12 h-12 rounded-lg mb-4 flex items-center justify-center" style={{ backgroundColor: "var(--primary-color)" }}>
              <span className="text-white text-sm font-bold">SA</span>
            </div>
            <h4 className="text-xl font-semibold mb-3">Scout Accuracy Tracking</h4>
            <p className="text-gray-600">
              Train and verify your scouts with practice modes. Track accuracy scores to ensure your data is reliable when it matters most.
            </p>
          </div>

          {/* Feature 4 */}
          <div className="bg-white rounded-xl shadow-md p-6 hover:shadow-lg transition-shadow">
            <div className="w-12 h-12 rounded-lg mb-4 flex items-center justify-center" style={{ backgroundColor: "var(--primary-color)" }}>
              <span className="text-white text-sm font-bold">MS</span>
            </div>
            <h4 className="text-xl font-semibold mb-3">Match Strategy Builder</h4>
            <p className="text-gray-600">
              Use historical data to predict outcomes and plan alliance strategies. Make informed decisions about partner selection and match approaches.
            </p>
          </div>

          {/* Feature 5 */}
          <div className="bg-white rounded-xl shadow-md p-6 hover:shadow-lg transition-shadow">
            <div className="w-12 h-12 rounded-lg mb-4 flex items-center justify-center" style={{ backgroundColor: "var(--primary-color)" }}>
              <span className="text-white text-sm font-bold">FB</span>
            </div>
            <h4 className="text-xl font-semibold mb-3">Custom Form Builder</h4>
            <p className="text-gray-600">
              Adapt to each season&apos;s unique game with customizable scouting forms. Track exactly what matters for your team&apos;s strategy.
            </p>
          </div>

          {/* Feature 6 */}
          <div className="bg-white rounded-xl shadow-md p-6 hover:shadow-lg transition-shadow">
            <div className="w-12 h-12 rounded-lg mb-4 flex items-center justify-center" style={{ backgroundColor: "var(--primary-color)" }}>
              <span className="text-white text-sm font-bold">TC</span>
            </div>
            <h4 className="text-xl font-semibold mb-3">Team Collaboration</h4>
            <p className="text-gray-600">
              Coordinate multiple scouts effortlessly. Assign matches, track completion, and ensure comprehensive coverage of every match.
            </p>
          </div>
        </div>
      </div>

      {/* HOW IT WORKS */}
      <div
        className="py-16 mt-16"
        style={{
          background: "linear-gradient(180deg, rgba(var(--primary-rgb), 0.05), rgba(var(--primary-rgb), 0.02))",
          borderTop: "1px solid rgba(var(--primary-rgb), 0.14)",
          borderBottom: "1px solid rgba(var(--primary-rgb), 0.14)",
        }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h3 className="text-3xl font-bold text-center mb-12">How It Works</h3>
          
          <div className="grid md:grid-cols-4 gap-8">
            <div className="text-center">
              <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center text-white text-2xl font-bold" style={{ backgroundColor: "var(--primary-color)" }}>
                1
              </div>
              <h4 className="font-semibold mb-2">Create Your Team</h4>
              <p className="text-gray-600 text-sm">Sign up and set up your team profile with scouts and coaches</p>
            </div>

            <div className="text-center">
              <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center text-white text-2xl font-bold" style={{ backgroundColor: "var(--primary-color)" }}>
                2
              </div>
              <h4 className="font-semibold mb-2">Configure Your Form</h4>
              <p className="text-gray-600 text-sm">Customize scouting fields to match this season&apos;s game</p>
            </div>

            <div className="text-center">
              <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center text-white text-2xl font-bold" style={{ backgroundColor: "var(--primary-color)" }}>
                3
              </div>
              <h4 className="font-semibold mb-2">Scout Matches</h4>
              <p className="text-gray-600 text-sm">Collect data during practice and competition matches</p>
            </div>

            <div className="text-center">
              <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center text-white text-2xl font-bold" style={{ backgroundColor: "var(--primary-color)" }}>
                4
              </div>
              <h4 className="font-semibold mb-2">Analyze & Win</h4>
              <p className="text-gray-600 text-sm">Review analytics and make strategic decisions to dominate.</p>
            </div>
          </div>
        </div>
      </div>

      {/* CTA SECTION */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="bg-gradient-to-r from-red-50 to-red-100 rounded-2xl p-12 text-center">
          <h3 className="text-3xl font-bold mb-4" style={{ color: "var(--primary-color)" }}>
            Ready to Transform Your Scouting?
          </h3>
          <p className="text-lg text-gray-700 mb-8 max-w-2xl mx-auto">
            Join teams using CompSocrates to gain a competitive edge. Start collecting better data today.
          </p>
          <button
            onClick={() => router.push("/signup")}
            className="px-8 py-4 rounded-lg text-white font-semibold text-lg shadow-lg hover:shadow-xl transition-shadow"
            style={{ backgroundColor: "var(--primary-color)" }}
          >
            Get Started Free
          </button>
        </div>
      </div>

      {/* FOOTER */}
      <footer className="bg-gray-900 text-white py-12 mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-2 gap-8">
            <div>
              <h5 className="font-bold mb-4">CompSocrates</h5>
              <p className="text-gray-400 text-sm">
                Strategic scouting software for FIRST Robotics Competition teams.
              </p>
            </div>
            <div>
              <h5 className="font-semibold mb-4">Legal</h5>
              <ul className="space-y-2 text-sm text-gray-400">
                <li>
                  <Link href="/privacy-policy" className="hover:text-white underline-offset-2 hover:underline">
                    Privacy Policy
                  </Link>
                </li>
                <li>
                  <Link href="/terms-of-service" className="hover:text-white underline-offset-2 hover:underline">
                    Terms of Service
                  </Link>
                </li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-800 mt-8 pt-8 text-center text-gray-400 text-sm">
            © 2026 CompSocrates. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}


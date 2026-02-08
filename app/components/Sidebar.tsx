"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/app/AuthContext";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/app/firebase";

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [teamName, setTeamName] = useState<string>("");
  const pathname = usePathname();
  const { userData, logOut } = useAuth();

  // Load collapsed state from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("sidebarCollapsed");
    if (saved) setCollapsed(JSON.parse(saved));
  }, []);

  // Save collapsed state to localStorage
  useEffect(() => {
    localStorage.setItem("sidebarCollapsed", JSON.stringify(collapsed));
  }, [collapsed]);

  // Load team name from Firestore
  useEffect(() => {
    async function loadTeamName() {
      if (!userData?.teamId) return;
      
      try {
        const teamDoc = await getDoc(doc(db, "teams", userData.teamId));
        if (teamDoc.exists()) {
          setTeamName(teamDoc.data().teamName || userData.teamId);
        } else {
          setTeamName(userData.teamId);
        }
      } catch (error) {
        console.error("Error loading team name:", error);
        setTeamName(userData.teamId);
      }
    }
    
    loadTeamName();
  }, [userData?.teamId]);

  if (!userData) return null;

  const isCoach = userData.role === "coach";
  const isScout = userData.role === "scout";
  
  // Check if user has special scout role
  const hasSpecialRole = userData.specialRole && 
    ["lead-scout", "lead-strategist", "pit-scout"].includes(userData.specialRole);

  // Navigation items based on role
  const coachNavItems = [
    { href: "/coach-dashboard", label: "Dashboard", icon: "📊" },
    { href: "/scout-form", label: "Scout Form", icon: "📝" },
    { href: "/analytics", label: "Analytics", icon: "📈" },
    { href: "/form-builder", label: "Form Builder", icon: "🔧" },
    { href: "/scout-accuracy", label: "Check Scout Accuracy", icon: "🎯" },
    { href: "/team-management", label: "Team Management", icon: "👥" },
  ];

  const scoutNavItems = [
    { href: "/scout-dashboard", label: "Dashboard", icon: "📊" },
    { href: "/scout-form", label: "Scout Form", icon: "📝" },
    { href: "/practice-scouting", label: "Practice Scouting", icon: "🎯" },
    { href: "/analytics", label: "Analytics", icon: "📈" },
  ];

  // Coaches with special roles also get practice scouting
  const navItems = isCoach 
    ? (hasSpecialRole ? [...coachNavItems.slice(0, 3), { href: "/practice-scouting", label: "Practice Scouting", icon: "🎯" }, ...coachNavItems.slice(3)] : coachNavItems)
    : scoutNavItems;

  return (
    <div
      className={`bg-white border-r border-gray-200 flex flex-col transition-all duration-300 ${
        collapsed ? "w-16" : "w-64"
      }`}
      style={{ height: "100vh", position: "sticky", top: 0 }}
    >
      {/* HEADER */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between">
          {!collapsed && (
            <div className="flex items-center gap-2">
              <div
                className="w-8 h-8 rounded text-white flex items-center justify-center font-bold text-sm"
                style={{ backgroundColor: "#c42221" }}
              >
                CS
              </div>
              <div>
                <h1 className="text-sm font-bold">CompSocrates</h1>
                <p className="text-xs text-gray-600">{teamName}</p>
              </div>
            </div>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-1.5 hover:bg-gray-100 rounded text-gray-600"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? "→" : "←"}
          </button>
        </div>
      </div>

      {/* NAVIGATION */}
      <nav className="flex-1 p-2 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`
                flex items-center gap-3 px-3 py-2 rounded mb-1 transition-colors
                ${isActive ? "bg-red-100 text-red-800 font-semibold" : "hover:bg-gray-100 text-gray-700"}
                ${collapsed ? "justify-center" : ""}
              `}
              title={collapsed ? item.label : ""}
            >
              <span className="text-lg">{item.icon}</span>
              {!collapsed && <span className="text-sm">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* USER PROFILE */}
      <div className="p-2 border-t border-gray-200 relative">
        <button
          onClick={() => setShowSettings(!showSettings)}
          className={`
            w-full flex items-center gap-3 px-3 py-2 rounded hover:bg-gray-100
            ${collapsed ? "justify-center" : ""}
          `}
        >
          <div
            className="w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center text-sm font-semibold text-gray-700"
          >
            {userData.displayName.substring(0, 2).toUpperCase()}
          </div>
          {!collapsed && (
            <div className="flex-1 text-left">
              <p className="text-sm font-semibold text-gray-900">{userData.displayName}</p>
              <p className="text-xs text-gray-600 capitalize">
                {userData.specialRole ? userData.specialRole.replace(/-/g, ' ') : userData.role}
              </p>
            </div>
          )}
        </button>

        {/* SETTINGS DROPDOWN */}
        {showSettings && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-40"
              onClick={() => setShowSettings(false)}
            />
            
            {/* Menu */}
            <div
              className={`
                absolute bottom-full mb-2 bg-white rounded-lg shadow-xl border border-gray-200 z-50
                ${collapsed ? "left-full ml-2 w-48" : "left-2 right-2"}
              `}
            >
              <Link
                href="/account"
                className="block px-4 py-2 hover:bg-gray-100 text-sm text-gray-700 rounded-t-lg"
                onClick={() => setShowSettings(false)}
              >
                Account Settings
              </Link>
              <button
                onClick={async () => {
                  await logOut();
                  setShowSettings(false);
                }}
                className="w-full text-left px-4 py-2 hover:bg-gray-100 text-sm text-red-600 rounded-b-lg"
              >
                Log Out
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
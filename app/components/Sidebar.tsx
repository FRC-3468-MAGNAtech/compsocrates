"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/app/AuthContext";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/app/firebase";
import { 
  BarChart3, ClipboardList, TrendingUp, Target, Users, 
  Wrench, Menu, X, ChevronLeft, ChevronRight, Calendar, UserCircle2, Settings
} from "lucide-react";

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return true;
    const saved = localStorage.getItem("sidebar-collapsed");
    if (saved !== null) return saved === "true";
    return window.innerWidth < 1024;
  });
  const [showSettings, setShowSettings] = useState(false);
  const [teamName, setTeamName] = useState<string>("");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const pathname = usePathname();
  const { userData, logOut } = useAuth();

  useEffect(() => {
    localStorage.setItem("sidebar-collapsed", String(collapsed));
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
  const showText = !collapsed || isMobileMenuOpen;

  // Navigation items based on role
  const coachNavItems = [
    { href: "/coach-dashboard", label: "Dashboard", icon: BarChart3 },
    { href: "/scout-form", label: "Match Scout Form", icon: ClipboardList },
    { href: "/pit-scout-form", label: "Pit Scout Form", icon: ClipboardList },
    { href: "/form-builder", label: "Form Builder", icon: Wrench },
    { href: "/analytics", label: "Analytics", icon: TrendingUp },
    { href: "/practice-scouting", label: "Practice Scouting", icon: Target },
    { href: "/scout-accuracy", label: "Scout Accuracy", icon: Target },
    { href: "/event-selection", label: "Event Selection", icon: Calendar },
    { href: "/assignments", label: "Assignments", icon: Calendar },
    { href: "/people", label: "People", icon: UserCircle2 },
    { href: "/team-management", label: "Team Management", icon: Users },
  ];

  const scoutNavItems = [
    { href: "/scout-dashboard", label: "Dashboard", icon: BarChart3 },
    { href: "/scout-form", label: "Match Scout Form", icon: ClipboardList },
    { href: "/pit-scout-form", label: "Pit Scout Form", icon: ClipboardList },
    { href: "/analytics", label: "Analytics", icon: TrendingUp },
    { href: "/practice-scouting", label: "Practice Scouting", icon: Target },
    { href: "/event-selection", label: "Event Selection", icon: Calendar },
    { href: "/people", label: "People", icon: UserCircle2 },
  ];

  // Set navigation based on role
  const navItems = isCoach ? coachNavItems : scoutNavItems;

  return (
    <>
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-40 md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}
      
      {/* Mobile hamburger button */}
      <button
        onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        className="md:hidden fixed top-4 left-4 z-50 p-2 bg-white rounded-lg shadow-lg"
        style={{ color: "var(--primary-color)" }}
      >
        {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
      </button>

      <div
        className={`
          bg-white border-r border-gray-200 flex flex-col transition-all duration-300
          ${isMobileMenuOpen ? "w-72" : collapsed ? "w-16" : "w-64"}
          ${isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"}
          md:translate-x-0
          fixed md:sticky top-0 h-screen z-40
        `}
      >
        {/* HEADER */}
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            {!collapsed && (
              <div className="flex items-center gap-2">
                <div
                  className="w-8 h-8 rounded text-white flex items-center justify-center font-bold text-sm"
                  style={{ background: "var(--primary-gradient)" }}
                >
                  CS
                </div>
                <div>
                  <h1 className="text-sm font-bold">CompSocrates</h1>
                  <p className="text-xs text-gray-600">Team {teamName}</p>
                </div>
              </div>
            )}
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="p-1.5 hover:bg-gray-100 rounded text-gray-600 hidden md:block"
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
            </button>
          </div>
        </div>

        {/* NAVIGATION */}
        <nav className="flex-1 p-2 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setIsMobileMenuOpen(false)}
                className={`
                  flex items-center gap-3 px-3 py-2 rounded mb-1 transition-colors
                  ${isActive ? "theme-primary-solid text-white font-semibold" : "hover:bg-gray-100 text-gray-700"}
                  justify-start
                `}
                title={collapsed ? item.label : ""}
              >
                <Icon size={20} />
                {showText && <span className="text-sm sidebar-text">{item.label}</span>}
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
              justify-start
            `}
          >
            {userData.photoURL ? (
              <img
                src={userData.photoURL}
                alt="Profile"
                className="w-8 h-8 rounded-full object-cover border border-gray-200"
              />
            ) : (
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold"
                style={{
                  background: "rgba(var(--primary-rgb), 0.22)",
                  color: "var(--theme-body-text)",
                  border: "1px solid rgba(var(--primary-rgb), 0.28)",
                }}
              >
                {userData.displayName.substring(0, 2).toUpperCase()}
              </div>
            )}
            {showText && (
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
              <div
                className="fixed inset-0 z-40"
                onClick={() => setShowSettings(false)}
              />
              
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
                {(isCoach || userData.isTeamAdmin) && (
                  <Link
                    href="/settings/api-keys"
                    className="block px-4 py-2 hover:bg-gray-100 text-sm text-gray-700"
                    onClick={() => setShowSettings(false)}
                  >
                    <span className="inline-flex items-center gap-2">
                      <Settings size={14} />
                      Team API Keys
                    </span>
                  </Link>
                )}
                <Link
                  href={`/profile/${userData.uid}`}
                  className="block px-4 py-2 hover:bg-gray-100 text-sm text-gray-700"
                  onClick={() => setShowSettings(false)}
                >
                  View Profile
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
    </>
  );
}

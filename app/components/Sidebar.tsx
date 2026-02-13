"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/app/AuthContext";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/app/firebase";
import { 
  BarChart3, ClipboardList, TrendingUp, Target, Users, 
  Wrench, Home, Menu, X, ChevronLeft, ChevronRight, Calendar 
} from "lucide-react";

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [teamName, setTeamName] = useState<string>("");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const pathname = usePathname();
  const { userData, logOut } = useAuth();

  // Auto-collapse on mobile
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) {
        setCollapsed(true);
      }
    };
    
    // Set initial state
    handleResize();
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Load collapsed state from localStorage (desktop only)
  useEffect(() => {
    if (window.innerWidth >= 768) {
      const saved = localStorage.getItem("sidebarCollapsed");
      if (saved) setCollapsed(JSON.parse(saved));
    }
  }, []);

  // Save collapsed state to localStorage
  useEffect(() => {
    if (window.innerWidth >= 768) {
      localStorage.setItem("sidebarCollapsed", JSON.stringify(collapsed));
    }
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
  
  // Check if user has special scout role
  const hasSpecialRole = userData.specialRole && 
    ["lead-scout", "lead-strategist", "pit-scout"].includes(userData.specialRole);

  // Icon mapping
  const iconMap = {
    "📊": BarChart3,
    "📝": ClipboardList,
    "📈": TrendingUp,
    "🔧": Wrench,
    "🎯": Target,
    "👥": Users,
  };

  // Navigation items based on role
  const coachNavItems = [
    { href: "/coach-dashboard", label: "Dashboard", icon: BarChart3 },
    { href: "/scout-form", label: "Scout Form", icon: ClipboardList },
    { href: "/analytics", label: "Analytics", icon: TrendingUp },
    { href: "/form-builder", label: "Form Builder", icon: Wrench },
    { href: "/scout-accuracy", label: "Check Scout Accuracy", icon: Target },
    { href: "/team-management", label: "Team Management", icon: Users },
    { href: "/assignments", label: "Assignments", icon: Calendar },
  ];

  const scoutNavItems = [
    { href: "/scout-dashboard", label: "Dashboard", icon: BarChart3 },
    { href: "/scout-form", label: "Scout Form", icon: ClipboardList },
    { href: "/practice-scouting", label: "Practice Scouting", icon: Target },
    { href: "/analytics", label: "Analytics", icon: TrendingUp },
  ];

  // Coaches with special roles also get practice scouting
  let navItems = isCoach ? coachNavItems : scoutNavItems;
  if (isCoach && hasSpecialRole) {
    navItems = [
      ...coachNavItems.slice(0, 2),
      { href: "/practice-scouting", label: "Practice Scouting", icon: Target },
      ...coachNavItems.slice(2)
    ];
  }

  // Mobile overlay
  const MobileOverlay = () => (
    <>
      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 z-40 md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}
    </>
  );

  return (
    <>
      <MobileOverlay />
      
      {/* Mobile hamburger button */}
      <button
        onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        className="md:hidden fixed top-4 left-4 z-50 p-2 bg-white rounded-lg shadow-lg"
        style={{ color: "#c42221" }}
      >
        {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
      </button>

      <div
        className={`
          bg-white border-r border-gray-200 flex flex-col transition-all duration-300
          ${collapsed ? "w-16" : "w-64"}
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
                  style={{ backgroundColor: "#c42221" }}
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
                  ${isActive ? "bg-red-100 text-red-800 font-semibold" : "hover:bg-gray-100 text-gray-700"}
                  ${collapsed ? "justify-center" : ""}
                `}
                title={collapsed ? item.label : ""}
              >
                <Icon size={20} />
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
                <Link
                  href={`/profile/${userData.uid}`}
                  className="block px-4 py-2 hover:bg-gray-100 text-sm text-gray-700"
                  onClick={() => setShowSettings(false)}
                >
                  View Profile
                </Link>
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
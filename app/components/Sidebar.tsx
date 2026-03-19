"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/app/AuthContext";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/app/firebase";
import { getDashboardRoute } from "@/app/utils/dashboardRoute";
import { canAccessForm, FormAccessOverrides, getRoleBadge, getUserRoles, normalizeFormAccessOverrides } from "@/app/utils/roles";
import { 
  BarChart3, ClipboardList, TrendingUp, Target, Users, 
  Menu, X, ChevronLeft, ChevronRight, Calendar, UserCircle2, Settings, Megaphone, BookOpen
} from "lucide-react";

export default function Sidebar() {
  const navScrollRef = useRef<HTMLElement | null>(null);
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return true;
    const saved = localStorage.getItem("sidebar-collapsed");
    if (saved !== null) return saved === "true";
    return window.innerWidth < 1024;
  });
  const [showSettings, setShowSettings] = useState(false);
  const [teamName, setTeamName] = useState<string>("");
  const [formAccessOverrides, setFormAccessOverrides] = useState<FormAccessOverrides>({});
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const pathname = usePathname();
  const { userData, logOut } = useAuth();

  useEffect(() => {
    localStorage.setItem("sidebar-collapsed", String(collapsed));
  }, [collapsed]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!isMobileMenuOpen) {
      document.body.style.overflow = "";
      document.body.style.touchAction = "";
      return;
    }
    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";
    return () => {
      document.body.style.overflow = "";
      document.body.style.touchAction = "";
    };
  }, [isMobileMenuOpen]);

  // Load team name from Firestore
  useEffect(() => {
    async function loadTeamName() {
      if (!userData?.teamId) return;
      
      try {
        const teamDoc = await getDoc(doc(db, "teams", userData.teamId));
        if (teamDoc.exists()) {
          const data = teamDoc.data();
          setTeamName(data.teamName || userData.teamId);
          setFormAccessOverrides(normalizeFormAccessOverrides(data.formAccessOverrides));
        } else {
          setTeamName(userData.teamId);
          setFormAccessOverrides({});
        }
      } catch (error) {
        console.error("Error loading team name:", error);
        setTeamName(userData.teamId);
        setFormAccessOverrides({});
      }
    }
    
    loadTeamName();
  }, [userData?.teamId]);

  const sidebarScrollKey = `sidebar-scroll-top:${userData?.teamId || "global"}`;
  const compactSidebar = collapsed && !isMobileMenuOpen;
  const showText = !collapsed || isMobileMenuOpen;
  const initials = userData?.displayName
    ? userData.displayName
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part.charAt(0).toUpperCase())
        .join("") || "U"
    : "U";

  const handleSidebarScroll = useCallback(() => {
    if (typeof window === "undefined" || !navScrollRef.current) return;
    sessionStorage.setItem(sidebarScrollKey, String(navScrollRef.current.scrollTop || 0));
  }, [sidebarScrollKey]);

  const restoreSidebarScroll = useCallback(() => {
    if (typeof window === "undefined" || !navScrollRef.current) return;
    const stored = sessionStorage.getItem(sidebarScrollKey);
    const parsed = Number(stored || 0);
    navScrollRef.current.scrollTop = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }, [sidebarScrollKey]);

  useEffect(() => {
    if (!userData?.teamId) return;
    restoreSidebarScroll();
    const timer = window.setTimeout(() => restoreSidebarScroll(), 0);
    return () => window.clearTimeout(timer);
  }, [pathname, sidebarScrollKey, userData?.teamId, restoreSidebarScroll]);

  if (!userData?.teamId) return null;

  const userRoles = getUserRoles(userData);
  const roleBadge = getRoleBadge(userData.role, userData.roles);
  const isLeadRole =
    userRoles.includes("lead-scout") ||
    userRoles.includes("lead-strategist") ||
    userRoles.includes("team-coach") ||
    userData.isTeamAdmin;
  const canManageAssignments = userRoles.includes("lead-scout") || userData.isTeamAdmin;

  const navItems = [
    { href: getDashboardRoute(userData), label: "Dashboard", icon: BarChart3 },
    ...(canAccessForm({ formKey: "match-scout-form", user: userData, formAccessOverrides })
      ? [{ href: "/scout-form?lead=0", label: "Match Scout Form", icon: ClipboardList }]
      : []),
    ...(canAccessForm({ formKey: "lead-scout-form", user: userData, formAccessOverrides })
      ? [{ href: "/scout-form?lead=1", label: "Lead Scout Form", icon: ClipboardList }]
      : []),
    ...(canAccessForm({ formKey: "pit-scout-form", user: userData, formAccessOverrides })
      ? [{ href: "/pit-scout-form", label: "Pit Scout Form", icon: ClipboardList }]
      : []),
    ...(canAccessForm({ formKey: "strategy-scout-form", user: userData, formAccessOverrides })
      ? [{ href: "/strategy-scout-form", label: "Team Strategy Form", icon: ClipboardList }]
      : []),
    ...(canAccessForm({ formKey: "match-strategy-form", user: userData, formAccessOverrides })
      ? [{ href: "/match-strategy-form", label: "Match Strategy Form", icon: ClipboardList }]
      : []),
    ...(canAccessForm({ formKey: "drive-scout-form", user: userData, formAccessOverrides })
      ? [{ href: "/drive-scout-form", label: "Drive Reflection Form", icon: ClipboardList }]
      : []),
    ...(canAccessForm({ formKey: "helper-form", user: userData, formAccessOverrides })
      ? [{ href: "/helper-form", label: "Helper Form", icon: ClipboardList }]
      : []),
    { href: "/analytics", label: "Analytics", icon: TrendingUp },
    { href: "/practice-scouting", label: "Practice Scouting", icon: Target },
    { href: "/scout-accuracy", label: "Scout Accuracy", icon: Target },
    { href: "/judge-book", label: "Judge Book", icon: BookOpen },
    ...(isLeadRole
      ? [
          { href: "/event-selection", label: "Event Selection", icon: Calendar },
        ]
      : []),
    { href: "/match-list", label: "Match List", icon: Calendar },
    ...(canManageAssignments ? [{ href: "/assignments", label: "Assignments", icon: Calendar }] : []),
    { href: "/people", label: "People", icon: UserCircle2 },
    ...(isLeadRole ? [{ href: "/team-management", label: "Team Management", icon: Users }] : []),
    ...(userData.isTeamAdmin ? [{ href: "/admin", label: "Admin Panel", icon: Settings }] : []),
  ];

  return (
    <>
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-[60] md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}
      
      {/* Mobile hamburger button */}
      <button
        onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        className="md:hidden fixed top-4 left-4 z-[80] p-2 bg-white rounded-lg shadow-lg touch-manipulation"
        style={{ color: "var(--primary-color)" }}
      >
        {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
      </button>

      <div
        className={`
          border-r border-gray-200 flex flex-col transition-all duration-300
          ${isMobileMenuOpen ? "w-72" : collapsed ? "w-16" : "w-64"}
          ${isMobileMenuOpen ? "translate-x-0 pointer-events-auto" : "-translate-x-full pointer-events-none md:pointer-events-auto"}
          md:translate-x-0
          fixed md:sticky top-0 h-screen z-[70] overflow-hidden
        `}
        style={{
          backgroundColor: "var(--theme-bg)",
          borderRightColor: "var(--theme-border)",
        }}
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
        <nav
          ref={navScrollRef}
          onScroll={handleSidebarScroll}
          className="flex-1 p-2 overflow-y-auto"
        >
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

        <div className="px-2 pb-2">
          <Link
            href="/changelog"
            onClick={() => setIsMobileMenuOpen(false)}
            className="inline-flex items-center justify-center w-10 h-10 rounded hover:bg-gray-100 text-gray-700"
            title="Changelog"
            aria-label="Changelog"
          >
            <Megaphone size={18} />
          </Link>
        </div>

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
                {initials}
              </div>
            )}
            {showText && (
              <div className="flex-1 text-left">
                <p className="text-sm font-semibold text-gray-900">{userData.displayName}</p>
                <p className="text-xs text-gray-600">{roleBadge.label}</p>
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
                  ${compactSidebar ? "left-0 w-48" : "left-2 right-2"}
                `}
              >
                <Link
                  href="/account"
                  className="block px-4 py-2 hover:bg-gray-100 text-sm text-gray-700 rounded-t-lg"
                  onClick={() => setShowSettings(false)}
                >
                  Account Settings
                </Link>
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

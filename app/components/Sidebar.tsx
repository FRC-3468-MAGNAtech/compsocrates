"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  BarChart3,
  BookOpen,
  Calendar,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Gauge,
  LogOut,
  Megaphone,
  Menu,
  Settings,
  Shield,
  Target,
  UserCircle2,
  Users,
  X,
} from "lucide-react";
import { doc, getDoc } from "firebase/firestore";
import { useAuth } from "@/app/AuthContext";
import { db } from "@/app/firebase";
import { getDashboardRoute } from "@/app/utils/dashboardRoute";
import {
  canAccessForm,
  FormAccessOverrides,
  getRoleBadge,
  getUserRoles,
  normalizeFormAccessOverrides,
} from "@/app/utils/roles";

type NavItem = {
  href: string;
  label: string;
  icon: typeof Gauge;
};

function isActiveRoute(pathname: string, href: string, leadView: boolean, matchView: boolean) {
  if (pathname === href) return true;
  if (pathname === "/scout-form" && href.startsWith("/scout-form")) {
    const leadHref = href.includes("lead=1");
    const matchHref = href.includes("lead=0");
    if (leadHref) return leadView;
    if (matchHref) return matchView;
    return matchView;
  }
  return href !== "/" && pathname.startsWith(`${href}/`);
}

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    const saved = localStorage.getItem("cs-nav-collapsed");
    if (saved !== null) return saved === "true";
    return window.innerWidth < 1180;
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [formAccessOverrides, setFormAccessOverrides] = useState<FormAccessOverrides>({});
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { userData, logOut } = useAuth();

  const leadParam = searchParams.get("lead");
  const isLeadView = leadParam === "1";
  const isMatchView = leadParam === "0" || leadParam === null || leadParam === "";

  useEffect(() => {
    localStorage.setItem("cs-nav-collapsed", String(collapsed));
  }, [collapsed]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  useEffect(() => {
    let active = true;
    async function loadTeamContext() {
      if (!userData?.teamId) {
        setTeamName("");
        setFormAccessOverrides({});
        return;
      }
      try {
        const teamDoc = await getDoc(doc(db, "teams", userData.teamId));
        if (!active) return;
        if (teamDoc.exists()) {
          const data = teamDoc.data();
          setTeamName(String(data.teamName || data.teamNumber || userData.teamId));
          setFormAccessOverrides(normalizeFormAccessOverrides(data.formAccessOverrides));
        } else {
          setTeamName(userData.teamId);
          setFormAccessOverrides({});
        }
      } catch (error) {
        console.error("Error loading team navigation context:", error);
        if (active) {
          setTeamName(userData.teamId);
          setFormAccessOverrides({});
        }
      }
    }
    void loadTeamContext();
    return () => {
      active = false;
    };
  }, [userData?.teamId]);

  const roleBadge = getRoleBadge(userData?.role, userData?.roles);
  const initials = useMemo(() => {
    const name = userData?.displayName || userData?.email || "User";
    return (
      name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part.charAt(0).toUpperCase())
        .join("") || "CS"
    );
  }, [userData?.displayName, userData?.email]);

  const navItems = useMemo<NavItem[]>(() => {
    if (!userData?.teamId) return [];
    const userRoles = getUserRoles(userData);
    const isLeadRole =
      userRoles.includes("lead-scout") ||
      userRoles.includes("lead-strategist") ||
      userRoles.includes("team-coach") ||
      Boolean(userData.isTeamAdmin);

    return [
      { href: getDashboardRoute(userData), label: "Dashboard", icon: Gauge },
      ...(canAccessForm({ formKey: "match-scout-form", user: userData, formAccessOverrides })
        ? [{ href: "/scout-form?lead=0", label: "Match Scout", icon: ClipboardList }]
        : []),
      ...(canAccessForm({ formKey: "lead-scout-form", user: userData, formAccessOverrides })
        ? [{ href: "/scout-form?lead=1", label: "Lead Scout", icon: Shield }]
        : []),
      ...(canAccessForm({ formKey: "pit-scout-form", user: userData, formAccessOverrides })
        ? [{ href: "/pit-scout-form", label: "Pit Scout", icon: ClipboardList }]
        : []),
      ...(canAccessForm({ formKey: "strategy-scout-form", user: userData, formAccessOverrides })
        ? [{ href: "/strategy-scout-form", label: "Team Strategy", icon: Target }]
        : []),
      ...(canAccessForm({ formKey: "match-strategy-form", user: userData, formAccessOverrides })
        ? [{ href: "/match-strategy-form", label: "Match Strategy", icon: Target }]
        : []),
      ...(canAccessForm({ formKey: "drive-scout-form", user: userData, formAccessOverrides })
        ? [{ href: "/drive-scout-form", label: "Drive Review", icon: ClipboardList }]
        : []),
      ...(canAccessForm({ formKey: "helper-form", user: userData, formAccessOverrides })
        ? [{ href: "/helper-form", label: "Helper Report", icon: ClipboardList }]
        : []),
      { href: "/analytics", label: "Analytics", icon: BarChart3 },
      { href: "/practice-scouting", label: "Practice", icon: Target },
      { href: "/scout-accuracy", label: "Accuracy", icon: Target },
      { href: "/judge-book", label: "Judge Book", icon: BookOpen },
      ...(isLeadRole ? [{ href: "/event-selection", label: "Events", icon: Calendar }] : []),
      { href: "/match-list", label: "Match List", icon: Calendar },
      { href: "/assignments", label: "Assignments", icon: Calendar },
      { href: "/people", label: "People", icon: UserCircle2 },
      ...(isLeadRole ? [{ href: "/team-management", label: "Team", icon: Users }] : []),
      ...(userData.isTeamAdmin ? [{ href: "/admin", label: "Admin", icon: Settings }] : []),
    ];
  }, [formAccessOverrides, userData]);

  if (!userData?.teamId) return null;

  const showLabels = !collapsed || mobileOpen;

  const nav = (
    <div
      className={`flex h-full flex-col rounded-r-[2rem] border-r border-white/70 bg-white/72 shadow-[18px_0_60px_rgba(139,0,0,0.09)] backdrop-blur-2xl transition-all duration-300 ${
        showLabels ? "w-72" : "w-[5.25rem]"
      }`}
    >
      <div className="border-b border-amber-200/40 p-4">
        <div className="flex items-center justify-between gap-3">
          <Link href={getDashboardRoute(userData)} className="flex min-w-0 items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-red-800 via-red-600 to-amber-300 text-sm font-black text-white shadow-lg shadow-red-900/20">
              CS
            </div>
            {showLabels && (
              <div className="min-w-0">
                <h2 className="font-display text-xl leading-none text-slate-950">CompSocrates</h2>
                <p className="mt-1 truncate text-xs font-semibold uppercase tracking-[0.18em] text-red-900/55">
                  {teamName || userData.teamId}
                </p>
              </div>
            )}
          </Link>
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            className="hidden h-9 w-9 shrink-0 place-items-center rounded-full border border-amber-200/70 bg-white/65 text-red-900 transition hover:bg-amber-50 lg:grid"
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
            title={collapsed ? "Expand navigation" : "Collapse navigation"}
          >
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isActiveRoute(pathname, item.href, isLeadView, isMatchView);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              title={showLabels ? undefined : item.label}
              className={`group flex h-12 items-center gap-3 rounded-2xl border px-3 text-sm font-bold transition duration-200 ${
                active
                  ? "border-red-700/30 bg-gradient-to-r from-red-800 to-red-600 text-white shadow-lg shadow-red-900/18"
                  : "border-transparent text-slate-600 hover:border-amber-200/70 hover:bg-white/78 hover:text-red-900 hover:shadow-md"
              } ${showLabels ? "justify-start" : "justify-center"}`}
            >
              <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
              {showLabels && <span className="truncate">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="space-y-3 border-t border-amber-200/40 p-3">
        <Link
          href="/changelog"
          onClick={() => setMobileOpen(false)}
          className={`flex h-11 items-center gap-3 rounded-2xl border border-transparent px-3 text-sm font-bold text-slate-600 transition hover:border-amber-200/70 hover:bg-white/78 hover:text-red-900 ${
            showLabels ? "justify-start" : "justify-center"
          }`}
          title="Changelog"
        >
          <Megaphone className="h-5 w-5" aria-hidden="true" />
          {showLabels && <span>Changelog</span>}
        </Link>

        <div className={`rounded-3xl border border-amber-200/50 bg-white/64 p-2 ${showLabels ? "" : "px-1"}`}>
          <Link
            href="/account"
            onClick={() => setMobileOpen(false)}
            className={`flex items-center gap-3 rounded-2xl p-2 transition hover:bg-amber-50/70 ${
              showLabels ? "justify-start" : "justify-center"
            }`}
            title="Account"
          >
            {userData.photoURL ? (
              <span
                aria-hidden="true"
                className="h-10 w-10 rounded-2xl border border-white bg-cover bg-center shadow-sm"
                style={{ backgroundImage: `url(${userData.photoURL})` }}
              />
            ) : (
              <div className="grid h-10 w-10 place-items-center rounded-2xl border border-amber-200 bg-amber-50 font-bold text-red-900">
                {initials}
              </div>
            )}
            {showLabels && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-slate-950">{userData.displayName}</p>
                <p className="truncate text-xs font-semibold text-slate-500">{roleBadge.label}</p>
              </div>
            )}
          </Link>
          <button
            type="button"
            onClick={() => void logOut()}
            className={`mt-1 flex h-10 w-full items-center gap-3 rounded-2xl px-3 text-sm font-bold text-red-800 transition hover:bg-red-50 ${
              showLabels ? "justify-start" : "justify-center"
            }`}
            title="Log out"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            {showLabels && <span>Log Out</span>}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="fixed left-4 top-4 z-[80] grid h-11 w-11 place-items-center rounded-2xl border border-white/70 bg-white/78 text-red-900 shadow-xl shadow-red-900/10 backdrop-blur-xl lg:hidden"
        aria-label="Open navigation"
      >
        <Menu size={22} />
      </button>

      {mobileOpen && (
        <div className="fixed inset-0 z-[70] bg-slate-950/25 backdrop-blur-sm lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      <aside className="sticky top-0 z-50 hidden h-screen shrink-0 lg:block">{nav}</aside>

      <aside
        className={`fixed inset-y-0 left-0 z-[90] h-screen transition-transform duration-300 lg:hidden ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="absolute right-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-full border border-amber-200 bg-white/80 text-red-900"
          aria-label="Close navigation"
        >
          <X size={18} />
        </button>
        {nav}
      </aside>
    </>
  );
}

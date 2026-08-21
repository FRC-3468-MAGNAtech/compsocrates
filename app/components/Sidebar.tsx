"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  BarChart3,
  BookOpen,
  Calendar,
  ClipboardList,
  Gauge,
  LogOut,
  Megaphone,
  Menu,
  Search,
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
import { HudPill } from "@/app/components/GreekTech";
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
  shortLabel: string;
  icon: typeof Gauge;
  priority?: boolean;
};

function isActiveRoute(pathname: string, href: string, leadView: boolean, matchView: boolean) {
  if (pathname === href) return true;
  if (pathname === "/scout-form" && href.startsWith("/scout-form")) {
    if (href.includes("lead=1")) return leadView;
    if (href.includes("lead=0")) return matchView;
    return matchView;
  }
  return href !== "/" && pathname.startsWith(`${href}/`);
}

export default function Sidebar() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [filter, setFilter] = useState("");
  const [formAccessOverrides, setFormAccessOverrides] = useState<FormAccessOverrides>({});
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { userData, logOut } = useAuth();

  const leadParam = searchParams.get("lead");
  const isLeadView = leadParam === "1";
  const isMatchView = leadParam === "0" || leadParam === null || leadParam === "";

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.style.overflow = paletteOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [paletteOpen]);

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
      { href: getDashboardRoute(userData), label: "Dashboard", shortLabel: "Home", icon: Gauge, priority: true },
      ...(canAccessForm({ formKey: "match-scout-form", user: userData, formAccessOverrides })
        ? [{ href: "/scout-form?lead=0", label: "Match Scout", shortLabel: "Scout", icon: ClipboardList, priority: true }]
        : []),
      ...(canAccessForm({ formKey: "lead-scout-form", user: userData, formAccessOverrides })
        ? [{ href: "/scout-form?lead=1", label: "Lead Scout", shortLabel: "Lead", icon: Shield }]
        : []),
      ...(canAccessForm({ formKey: "pit-scout-form", user: userData, formAccessOverrides })
        ? [{ href: "/pit-scout-form", label: "Pit Scout", shortLabel: "Pit", icon: ClipboardList }]
        : []),
      ...(canAccessForm({ formKey: "strategy-scout-form", user: userData, formAccessOverrides })
        ? [{ href: "/strategy-scout-form", label: "Team Strategy", shortLabel: "Team", icon: Target }]
        : []),
      ...(canAccessForm({ formKey: "match-strategy-form", user: userData, formAccessOverrides })
        ? [{ href: "/match-strategy-form", label: "Match Strategy", shortLabel: "Match", icon: Target, priority: true }]
        : []),
      ...(canAccessForm({ formKey: "drive-scout-form", user: userData, formAccessOverrides })
        ? [{ href: "/drive-scout-form", label: "Drive Review", shortLabel: "Drive", icon: ClipboardList }]
        : []),
      ...(canAccessForm({ formKey: "helper-form", user: userData, formAccessOverrides })
        ? [{ href: "/helper-form", label: "Helper Report", shortLabel: "Help", icon: ClipboardList }]
        : []),
      { href: "/analytics", label: "Analytics", shortLabel: "Intel", icon: BarChart3, priority: true },
      { href: "/practice-scouting", label: "Practice Verification", shortLabel: "Verify", icon: Target, priority: true },
      { href: "/scout-accuracy", label: "Scout Accuracy", shortLabel: "Accuracy", icon: Target, priority: true },
      { href: "/judge-book", label: "Judge Book", shortLabel: "Judge", icon: BookOpen },
      ...(isLeadRole ? [{ href: "/event-selection", label: "Event Selection", shortLabel: "Events", icon: Calendar }] : []),
      { href: "/match-list", label: "Match List", shortLabel: "Matches", icon: Calendar },
      { href: "/assignments", label: "Assignments", shortLabel: "Assign", icon: Calendar },
      { href: "/people", label: "People", shortLabel: "People", icon: UserCircle2 },
      ...(isLeadRole ? [{ href: "/team-management", label: "Team Management", shortLabel: "Roster", icon: Users }] : []),
      ...(userData.isTeamAdmin ? [{ href: "/admin", label: "Admin", shortLabel: "Admin", icon: Settings }] : []),
    ];
  }, [formAccessOverrides, userData]);

  if (!userData?.teamId) return null;

  const priorityItems = navItems.filter((item) => item.priority).slice(0, 7);
  const filteredItems = navItems.filter((item) => item.label.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 top-4 z-[80] flex justify-center px-3">
        <HudPill className="pointer-events-auto flex max-w-[calc(100vw-1.5rem)] items-center gap-2 overflow-x-auto px-2 py-2">
          <Link href={getDashboardRoute(userData)} className="flex shrink-0 items-center gap-2 rounded-full border border-white/70 bg-white/45 py-1.5 pl-2 pr-3 shadow-inner shadow-white/50">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-red-800 via-red-600 to-amber-300 text-xs font-black text-white shadow-lg shadow-red-900/20">
              CS
            </div>
            <div className="hidden min-w-0 sm:block">
              <p className="font-display text-base leading-none text-slate-950">CompSocrates</p>
              <p className="mt-0.5 max-w-32 truncate text-[10px] font-bold uppercase tracking-[0.18em] text-red-900/55">
                {teamName || userData.teamId}
              </p>
            </div>
          </Link>

          <div className="flex shrink-0 items-center gap-1">
            {priorityItems.map((item) => {
              const Icon = item.icon;
              const active = isActiveRoute(pathname, item.href, isLeadView, isMatchView);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex h-10 items-center gap-2 rounded-full border px-3 text-xs font-black transition duration-200 hover:-translate-y-px ${
                    active
                      ? "border-amber-300/70 bg-red-700/90 text-white shadow-[0_10px_34px_rgba(139,0,0,0.22)]"
                      : "border-white/60 bg-white/25 text-slate-800 hover:bg-white/55 hover:text-red-900"
                  }`}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  <span className="hidden md:inline">{item.shortLabel}</span>
                </Link>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-amber-300/50 bg-white/35 text-red-900 shadow-[0_8px_30px_rgba(212,175,55,0.12)] transition hover:-translate-y-px hover:bg-white/60"
            aria-label="Open command navigation"
          >
            <Menu size={19} />
          </button>

          <Link
            href="/account"
            className="hidden h-10 shrink-0 items-center gap-2 rounded-full border border-white/60 bg-white/25 px-2 pr-3 text-xs font-bold text-slate-700 transition hover:bg-white/55 lg:flex"
          >
            {userData.photoURL ? (
              <span
                aria-hidden="true"
                className="h-7 w-7 rounded-full border border-white bg-cover bg-center"
                style={{ backgroundImage: `url(${userData.photoURL})` }}
              />
            ) : (
              <span className="grid h-7 w-7 place-items-center rounded-full bg-amber-100 text-[10px] text-red-900">{initials}</span>
            )}
            {roleBadge.label}
          </Link>
        </HudPill>
      </div>

      {paletteOpen && (
        <div className="fixed inset-0 z-[100] bg-slate-900/20 p-4 backdrop-blur-md" onClick={() => setPaletteOpen(false)}>
          <div
            className="mx-auto mt-16 max-h-[calc(100vh-6rem)] w-full max-w-4xl overflow-hidden rounded-[2rem] border border-white/70 border-b-amber-500/20 border-r-red-500/20 bg-white/40 shadow-[0_30px_120px_rgba(139,0,0,0.18)] backdrop-blur-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-white/50 p-4">
              <div>
                <h2 className="font-display text-2xl text-slate-950">Command Navigation</h2>
                <p className="mt-1 text-xs font-bold uppercase tracking-[0.2em] text-red-900/55">{teamName || userData.teamId}</p>
              </div>
              <button
                type="button"
                onClick={() => setPaletteOpen(false)}
                className="grid h-10 w-10 place-items-center rounded-full border border-white/70 bg-white/45 text-red-900"
                aria-label="Close command navigation"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-4">
              <div className="relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder="Find a workspace"
                  className="w-full py-3 pl-11 pr-4 text-sm font-bold"
                />
              </div>

              <div className="mt-4 grid max-h-[54vh] gap-3 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
                {filteredItems.map((item) => {
                  const Icon = item.icon;
                  const active = isActiveRoute(pathname, item.href, isLeadView, isMatchView);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setPaletteOpen(false)}
                      className={`group rounded-[1.5rem] border p-4 transition duration-200 hover:-translate-y-1 ${
                        active
                          ? "border-amber-300/70 bg-red-700/90 text-white shadow-[0_16px_50px_rgba(139,0,0,0.22)]"
                          : "border-white/70 bg-white/32 text-slate-900 shadow-[0_12px_36px_rgba(15,23,42,0.08)] hover:bg-white/52"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className={`grid h-11 w-11 place-items-center rounded-full ${active ? "bg-white/18" : "bg-amber-100/60 text-red-900"}`}>
                          <Icon className="h-5 w-5" aria-hidden="true" />
                        </span>
                        <div>
                          <p className="font-bold">{item.label}</p>
                          <p className={`mt-1 text-xs font-semibold ${active ? "text-white/75" : "text-slate-500"}`}>Open workspace</p>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-full border border-white/60 bg-white/28 px-3 py-2">
                <Link href="/changelog" onClick={() => setPaletteOpen(false)} className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-bold text-slate-700 hover:bg-white/50">
                  <Megaphone className="h-4 w-4" />
                  Changelog
                </Link>
                <button
                  type="button"
                  onClick={() => void logOut()}
                  className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-bold text-red-800 hover:bg-red-50/70"
                >
                  <LogOut className="h-4 w-4" />
                  Log Out
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

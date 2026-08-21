"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Database, Filter, Search, StickyNote } from "lucide-react";
import Sidebar from "@/app/components/Sidebar";
import { AnalyticsNotesProvider, useAnalyticsNotesSettings } from "@/app/components/AnalyticsNotesContext";
import { FloatingDeck, GreekHeader, GreekTechBackground, HudPill, SectionShell, StatBadge } from "@/app/components/GreekTech";
import { useAuth } from "@/app/AuthContext";
import { getUserRoles } from "@/app/utils/roles";

type AnalyticsShellProps = {
  children: React.ReactNode;
  entriesCount: number;
  selectedGame: string;
  onSelectedGameChange: (game: string) => void;
  allowedGames?: string[];
  practiceMatchesOnly?: boolean;
  onPracticeMatchesOnlyChange?: (practiceOnly: boolean) => void;
  selectedEvent?: string;
  eventOptions?: Array<{ id: string; name: string }>;
  onSelectedEventChange?: (eventId: string) => void;
  extraControls?: React.ReactNode;
};

const analyticsLinks: Array<{ href: string; label: string; weight: "prime" | "support" }> = [
  { href: "/analytics/match-strategy", label: "Match Strategy", weight: "prime" },
  { href: "/analytics/scout-status", label: "Scout Matrix", weight: "prime" },
  { href: "/analytics/team-breakdown", label: "Team Breakdown", weight: "prime" },
  { href: "/analytics", label: "Match Data", weight: "support" },
  { href: "/analytics/team-averages", label: "Team Averages", weight: "support" },
  { href: "/analytics/robot-radar", label: "Robot Radar", weight: "support" },
  { href: "/analytics/rankings", label: "Rankings", weight: "support" },
  { href: "/analytics/pick-list", label: "Pick List", weight: "support" },
  { href: "/analytics/performance-reliability", label: "Reliability", weight: "support" },
  { href: "/analytics/match-breakdown", label: "Match Breakdown", weight: "support" },
  { href: "/analytics/lead", label: "Lead Review", weight: "support" },
  { href: "/analytics/pit", label: "Pit Intel", weight: "support" },
  { href: "/analytics/team-strategy", label: "Team Strategy", weight: "support" },
  { href: "/analytics/drive-reflection", label: "Drive Review", weight: "support" },
  { href: "/analytics/helper", label: "Helper Reports", weight: "support" },
];

function canSeeScoutStatus(userData: ReturnType<typeof useAuth>["userData"]) {
  const roles = getUserRoles(userData);
  return (
    Boolean(userData?.isTeamAdmin) ||
    roles.includes("lead-scout") ||
    roles.includes("lead-strategist") ||
    roles.includes("team-coach") ||
    userData?.role === "coach"
  );
}

function useAnalyticsSearch(rootRef: React.RefObject<HTMLDivElement | null>, searchTerm: string) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("analytics-search-term", searchTerm);
    window.dispatchEvent(new CustomEvent("analytics-search-term", { detail: searchTerm }));
  }, [searchTerm]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const normalized = searchTerm.trim().toLowerCase();
    const applySearch = () => {
      for (const row of Array.from(root.querySelectorAll("tbody tr"))) {
        const target = row as HTMLElement;
        target.style.display = !normalized || (target.textContent || "").toLowerCase().includes(normalized) ? "" : "none";
      }
      for (const node of Array.from(root.querySelectorAll("[data-analytics-search-item='true']"))) {
        const item = node as HTMLElement;
        item.style.display = !normalized || (item.textContent || "").toLowerCase().includes(normalized) ? "" : "none";
      }
    };
    applySearch();
    const observer = new MutationObserver(applySearch);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [rootRef, searchTerm]);
}

function NotesToggle() {
  const { autoExpandNotes, setAutoExpandNotes } = useAnalyticsNotesSettings();
  return (
    <button
      type="button"
      onClick={() => setAutoExpandNotes(!autoExpandNotes)}
      className={`inline-flex h-11 items-center gap-2 rounded-full border px-4 text-sm font-black transition ${
        autoExpandNotes
          ? "border-amber-300/70 bg-amber-100/70 text-amber-950 shadow-[0_8px_30px_rgba(212,175,55,0.14)]"
          : "border-white/70 bg-white/35 text-slate-700 hover:bg-white/60"
      }`}
    >
      <StickyNote className="h-4 w-4" aria-hidden="true" />
      Notes
    </button>
  );
}

function AnalyticsShellInner({
  children,
  entriesCount,
  selectedGame,
  onSelectedGameChange,
  allowedGames = ["CHARGED_UP", "REEFSCAPE", "REBUILT"],
  practiceMatchesOnly = false,
  onPracticeMatchesOnlyChange,
  selectedEvent,
  eventOptions = [],
  onSelectedEventChange,
  extraControls,
}: AnalyticsShellProps) {
  const { userData } = useAuth();
  const pathname = usePathname();
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [searchTerm, setSearchTerm] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("analytics-search-term") || "";
  });

  const effectiveEventOptions = useMemo(() => {
    if (selectedGame === "REEFSCAPE") {
      if (!practiceMatchesOnly) return eventOptions;
      const base = eventOptions.filter((option) => option.id !== "app-testing");
      const einstein = { id: "2025cmptx", name: "Einstein Field" };
      const withoutEinstein = base.filter((option) => option.id !== "2025cmptx");
      const bayouIndex = withoutEinstein.findIndex((option) => option.id === "2025lake");
      if (bayouIndex >= 0) return [...withoutEinstein.slice(0, bayouIndex + 1), einstein, ...withoutEinstein.slice(bayouIndex + 1)];
      return [...withoutEinstein, einstein];
    }

    if (selectedGame === "REBUILT") {
      const withoutWeek0 = eventOptions.filter((option) => option.id !== "2026week0");
      if (!practiceMatchesOnly) return withoutWeek0;
      const withoutWeek0OrTesting = withoutWeek0.filter((option) => option.id !== "app-testing");
      const week0 = eventOptions.find((option) => option.id === "2026week0") || { id: "2026week0", name: "Week 0" };
      const arkansasIndex = withoutWeek0OrTesting.findIndex((option) => option.id === "2026arli");
      if (arkansasIndex >= 0) return [...withoutWeek0OrTesting.slice(0, arkansasIndex), week0, ...withoutWeek0OrTesting.slice(arkansasIndex)];
      return [week0, ...withoutWeek0OrTesting];
    }

    return eventOptions;
  }, [eventOptions, practiceMatchesOnly, selectedGame]);

  useAnalyticsSearch(contentRef, searchTerm);

  useEffect(() => {
    if (allowedGames.length === 0) return;
    if (!allowedGames.includes(selectedGame)) onSelectedGameChange(allowedGames[0]);
  }, [allowedGames, onSelectedGameChange, selectedGame]);

  useEffect(() => {
    if (!onSelectedEventChange || !selectedEvent || effectiveEventOptions.length === 0) return;
    if (!effectiveEventOptions.some((option) => option.id === selectedEvent)) onSelectedEventChange(effectiveEventOptions[0].id);
  }, [effectiveEventOptions, onSelectedEventChange, selectedEvent]);

  const visibleLinks = analyticsLinks.filter((item) => item.href !== "/analytics/scout-status" || canSeeScoutStatus(userData));
  const primeLinks = visibleLinks.filter((item) => item.weight === "prime");
  const supportLinks = visibleLinks.filter((item) => item.weight === "support");

  return (
    <GreekTechBackground>
      <Sidebar />
      <SectionShell className="space-y-6">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_23rem]">
          <FloatingDeck priority="high" className="min-h-52 p-6 lg:p-8">
            <GreekHeader
              eyebrow="Real-Time Strategy"
              title="Analytics Flight Deck"
              subtitle="Scout trends, matchup pressure, verification health, and team profiles share one high-visibility control surface."
              actions={
                <>
                  <StatBadge icon={Database} label="Entries" value={entriesCount} tone="gold" />
                  <StatBadge icon={BarChart3} label="Game" value={selectedGame.replace("_", " ")} tone="crimson" />
                </>
              }
            />
          </FloatingDeck>

          <FloatingDeck priority="critical" className="xl:translate-y-10">
            <p className="text-xs font-black uppercase tracking-[0.24em] text-red-900/60">Priority Views</p>
            <div className="mt-4 grid gap-3">
              {primeLinks.map((item, index) => {
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`rounded-[1.5rem] border p-4 transition duration-200 hover:-translate-y-1 ${
                      active
                        ? "border-amber-300/70 bg-red-700/90 text-white shadow-[0_16px_50px_rgba(139,0,0,0.22)]"
                        : "border-white/70 bg-white/30 text-slate-900 hover:bg-white/55"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <span className="font-black">{item.label}</span>
                      <span className={`font-mono text-xs ${active ? "text-white/75" : "text-amber-800"}`}>0{index + 1}</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </FloatingDeck>
        </div>

        <HudPill className="mx-auto flex w-full max-w-6xl flex-col gap-3 p-3 lg:flex-row lg:items-center">
          <div className="relative min-w-[14rem] flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search active analytics surface"
              className="w-full py-3 pl-11 pr-4 text-sm font-bold"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <NotesToggle />
            {extraControls}
            {onPracticeMatchesOnlyChange && (
              <button
                type="button"
                onClick={() => onPracticeMatchesOnlyChange(!practiceMatchesOnly)}
                className={`h-11 rounded-full border px-4 text-sm font-black transition ${
                  practiceMatchesOnly
                    ? "border-red-300/70 bg-red-50/70 text-red-900"
                    : "border-white/70 bg-white/35 text-slate-700 hover:bg-white/60"
                }`}
              >
                Practice
              </button>
            )}
            <select value={selectedGame} onChange={(event) => onSelectedGameChange(event.target.value)} className="h-11 px-4 text-sm font-black">
              {allowedGames.includes("CHARGED_UP") && <option value="CHARGED_UP">CHARGED UP</option>}
              {allowedGames.includes("REEFSCAPE") && <option value="REEFSCAPE">REEFSCAPE</option>}
              {allowedGames.includes("REBUILT") && <option value="REBUILT">REBUILT</option>}
            </select>
            {effectiveEventOptions.length > 0 && onSelectedEventChange && (
              <select value={selectedEvent} onChange={(event) => onSelectedEventChange(event.target.value)} className="h-11 max-w-64 px-4 text-sm font-black">
                {effectiveEventOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </HudPill>

        <div className="grid gap-5 2xl:grid-cols-[13rem_minmax(0,1fr)_11rem]">
          <FloatingDeck className="hidden self-start 2xl:block">
            <p className="mb-4 flex items-center gap-2 text-xs font-black uppercase tracking-[0.22em] text-red-900/60">
              <Filter className="h-4 w-4" />
              Views
            </p>
            <div className="space-y-2">
              {supportLinks.slice(0, 8).map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`block rounded-full border px-3 py-2 text-xs font-black transition ${
                    pathname === item.href
                      ? "border-red-300/70 bg-red-700/90 text-white"
                      : "border-white/60 bg-white/25 text-slate-700 hover:bg-white/55"
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </FloatingDeck>

          <main ref={contentRef} className="min-w-0 rounded-[2rem] border border-white/45 bg-white/18 p-1 shadow-[0_22px_90px_rgba(15,23,42,0.08)] backdrop-blur-sm">
            {children}
          </main>

          <div className="hidden space-y-5 pt-20 2xl:block">
            <FloatingDeck priority="high" className="p-4">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-900/70">Focus</p>
              <p className="mt-3 font-display text-2xl text-slate-950">Matchup</p>
            </FloatingDeck>
            <FloatingDeck priority="critical" className="p-4">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-red-900/70">Signal</p>
              <p className="mt-3 font-display text-2xl text-slate-950">Accuracy</p>
            </FloatingDeck>
          </div>
        </div>
      </SectionShell>
    </GreekTechBackground>
  );
}

export default function AnalyticsShell(props: AnalyticsShellProps) {
  return (
    <AnalyticsNotesProvider>
      <AnalyticsShellInner {...props} />
    </AnalyticsNotesProvider>
  );
}

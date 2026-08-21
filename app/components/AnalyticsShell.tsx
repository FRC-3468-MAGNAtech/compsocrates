"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight, Database, Menu, Search, StickyNote, X } from "lucide-react";
import Sidebar from "@/app/components/Sidebar";
import { AnalyticsNotesProvider, useAnalyticsNotesSettings } from "@/app/components/AnalyticsNotesContext";
import { GreekHeader, GreekTechBackground, PillButton, SectionShell, StatBadge } from "@/app/components/GreekTech";
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

const analyticsLinks: Array<{ href: string; label: string } | { divider: true }> = [
  { href: "/analytics", label: "Match Data" },
  { href: "/analytics/lead", label: "Lead Review" },
  { href: "/analytics/pit", label: "Pit Intel" },
  { href: "/analytics/team-strategy", label: "Team Strategy" },
  { href: "/analytics/match-strategy", label: "Match Strategy" },
  { href: "/analytics/drive-reflection", label: "Drive Review" },
  { href: "/analytics/helper", label: "Helper Reports" },
  { divider: true },
  { href: "/analytics/team-averages", label: "Team Averages" },
  { href: "/analytics/match-breakdown", label: "Match Breakdown" },
  { href: "/analytics/rankings", label: "Rankings" },
  { href: "/analytics/team-breakdown", label: "Team Breakdown" },
  { href: "/analytics/performance-reliability", label: "Reliability" },
  { href: "/analytics/robot-radar", label: "Robot Radar" },
  { href: "/analytics/pick-list", label: "Pick List" },
  { href: "/analytics/scout-status", label: "Scout Status" },
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
      const rows = Array.from(root.querySelectorAll("tbody tr"));
      rows.forEach((row) => {
        const target = row as HTMLElement;
        if (!normalized) {
          target.style.removeProperty("display");
          return;
        }
        target.style.display = (target.textContent || "").toLowerCase().includes(normalized) ? "" : "none";
      });

      const cards = Array.from(root.querySelectorAll("[data-analytics-search-item='true']"));
      cards.forEach((node) => {
        const item = node as HTMLElement;
        if (!normalized) {
          item.style.removeProperty("display");
          return;
        }
        item.style.display = (item.textContent || "").toLowerCase().includes(normalized) ? "" : "none";
      });
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
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-bold transition ${
        autoExpandNotes
          ? "border-amber-300 bg-amber-100 text-amber-950"
          : "border-slate-200 bg-white/70 text-slate-600 hover:bg-white"
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
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    const saved = localStorage.getItem("analytics-panel-collapsed");
    return saved === "true";
  });
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
      if (bayouIndex >= 0) {
        return [
          ...withoutEinstein.slice(0, bayouIndex + 1),
          einstein,
          ...withoutEinstein.slice(bayouIndex + 1),
        ];
      }
      return [...withoutEinstein, einstein];
    }

    if (selectedGame === "REBUILT") {
      const withoutWeek0 = eventOptions.filter((option) => option.id !== "2026week0");
      if (!practiceMatchesOnly) return withoutWeek0;
      const withoutWeek0OrTesting = withoutWeek0.filter((option) => option.id !== "app-testing");
      const week0 = eventOptions.find((option) => option.id === "2026week0") || { id: "2026week0", name: "Week 0" };
      const arkansasIndex = withoutWeek0OrTesting.findIndex((option) => option.id === "2026arli");
      if (arkansasIndex >= 0) {
        return [
          ...withoutWeek0OrTesting.slice(0, arkansasIndex),
          week0,
          ...withoutWeek0OrTesting.slice(arkansasIndex),
        ];
      }
      return [week0, ...withoutWeek0OrTesting];
    }

    return eventOptions;
  }, [eventOptions, practiceMatchesOnly, selectedGame]);

  useAnalyticsSearch(contentRef, searchTerm);

  useEffect(() => {
    localStorage.setItem("analytics-panel-collapsed", String(panelCollapsed));
  }, [panelCollapsed]);

  useEffect(() => {
    if (allowedGames.length === 0) return;
    if (!allowedGames.includes(selectedGame)) onSelectedGameChange(allowedGames[0]);
  }, [allowedGames, onSelectedGameChange, selectedGame]);

  useEffect(() => {
    if (!onSelectedEventChange || !selectedEvent || effectiveEventOptions.length === 0) return;
    if (!effectiveEventOptions.some((option) => option.id === selectedEvent)) {
      onSelectedEventChange(effectiveEventOptions[0].id);
    }
  }, [effectiveEventOptions, onSelectedEventChange, selectedEvent]);

  const visibleLinks = analyticsLinks.filter((item) => {
    if ("divider" in item) return true;
    return item.href !== "/analytics/scout-status" || canSeeScoutStatus(userData);
  });

  const panel = (
    <div className="flex h-full flex-col rounded-[2rem] border border-white/70 bg-white/72 p-3 shadow-[0_24px_80px_rgba(139,0,0,0.1)] backdrop-blur-2xl">
      <div className="border-b border-amber-200/40 p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-2xl text-slate-950">Analytics</h2>
            <p className="mt-1 text-xs font-bold uppercase tracking-[0.2em] text-red-900/55">Strategy Views</p>
          </div>
          <button
            type="button"
            onClick={() => setPanelCollapsed((value) => !value)}
            className="hidden h-9 w-9 place-items-center rounded-full border border-amber-200/70 bg-white/65 text-red-900 transition hover:bg-amber-50 xl:grid"
            aria-label={panelCollapsed ? "Expand analytics panel" : "Collapse analytics panel"}
          >
            {panelCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
        </div>
        {effectiveEventOptions.length > 0 && onSelectedEventChange && (
          <select
            value={selectedEvent}
            onChange={(event) => onSelectedEventChange(event.target.value)}
            className="mt-4 w-full px-3 py-2 text-sm font-semibold"
          >
            {effectiveEventOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-2">
        {visibleLinks.map((item, index) => {
          if ("divider" in item) {
            return <div key={`divider-${index}`} className="my-3 h-px bg-gradient-to-r from-transparent via-amber-200 to-transparent" />;
          }
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobilePanelOpen(false)}
              className={`block rounded-2xl border px-4 py-3 text-sm font-bold transition ${
                active
                  ? "border-red-700/30 bg-gradient-to-r from-red-800 to-red-600 text-white shadow-lg shadow-red-900/18"
                  : "border-transparent text-slate-600 hover:border-amber-200/70 hover:bg-white/78 hover:text-red-900"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );

  return (
    <GreekTechBackground>
      <div className="flex min-h-screen">
        <Sidebar />
        <div className="min-w-0 flex-1">
          <SectionShell className="min-h-screen space-y-6">
            <GreekHeader
              eyebrow="CompSocrates Strategy"
              title="Analytics Command"
              subtitle="Filter scouting records, compare events, and move between strategy views without changing the underlying scoring logic."
              actions={<StatBadge icon={Database} label="Entries" value={entriesCount} tone="gold" />}
            />

            <div className="grid gap-6 xl:grid-cols-[18rem_minmax(0,1fr)]">
              {!panelCollapsed && <aside className="hidden h-[calc(100vh-11rem)] xl:block">{panel}</aside>}

              <div className="min-w-0 space-y-4">
                <div className="rounded-[2rem] border border-white/70 bg-white/72 p-3 shadow-xl shadow-red-900/5 backdrop-blur-2xl">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <PillButton
                        variant="ghost"
                        className="xl:hidden"
                        onClick={() => setMobilePanelOpen(true)}
                        aria-label="Open analytics navigation"
                      >
                        <Menu className="h-4 w-4" />
                      </PillButton>
                      {panelCollapsed && (
                        <PillButton variant="ghost" className="hidden xl:inline-flex" onClick={() => setPanelCollapsed(false)}>
                          <ChevronRight className="h-4 w-4" />
                          Views
                        </PillButton>
                      )}
                      <div className="relative min-w-[14rem] flex-1 lg:max-w-md">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <input
                          type="search"
                          value={searchTerm}
                          onChange={(event) => setSearchTerm(event.target.value)}
                          placeholder="Search this view"
                          className="w-full py-2 pl-9 pr-3 text-sm font-semibold"
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <NotesToggle />
                      {extraControls}
                      {onPracticeMatchesOnlyChange && (
                        <button
                          type="button"
                          onClick={() => onPracticeMatchesOnlyChange(!practiceMatchesOnly)}
                          className={`rounded-full border px-3 py-2 text-sm font-bold transition ${
                            practiceMatchesOnly
                              ? "border-red-300 bg-red-50 text-red-900"
                              : "border-slate-200 bg-white/70 text-slate-600 hover:bg-white"
                          }`}
                        >
                          Practice
                        </button>
                      )}
                      <select
                        value={selectedGame}
                        onChange={(event) => onSelectedGameChange(event.target.value)}
                        className="px-3 py-2 text-sm font-bold"
                      >
                        {allowedGames.includes("CHARGED_UP") && <option value="CHARGED_UP">CHARGED UP</option>}
                        {allowedGames.includes("REEFSCAPE") && <option value="REEFSCAPE">REEFSCAPE</option>}
                        {allowedGames.includes("REBUILT") && <option value="REBUILT">REBUILT</option>}
                      </select>
                    </div>
                  </div>
                </div>

                <div ref={contentRef} className="min-w-0 pb-10">
                  {children}
                </div>
              </div>
            </div>
          </SectionShell>
        </div>

        {mobilePanelOpen && (
          <div className="fixed inset-0 z-[90] bg-slate-950/25 p-4 backdrop-blur-sm xl:hidden">
            <button
              type="button"
              onClick={() => setMobilePanelOpen(false)}
              className="absolute right-6 top-6 z-10 grid h-9 w-9 place-items-center rounded-full border border-amber-200 bg-white/80 text-red-900"
              aria-label="Close analytics navigation"
            >
              <X size={18} />
            </button>
            <div className="h-full max-w-sm">{panel}</div>
          </div>
        )}
      </div>
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

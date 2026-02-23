"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Sidebar from "@/app/components/Sidebar";

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
};

const analyticsLinks: Array<{ href: string; label: string } | { divider: true }> = [
  { href: "/analytics", label: "Match Analytics" },
  { href: "/analytics/pit", label: "Pit Analytics" },
  { href: "/analytics/team-strategy", label: "Team Strategy" },
  { href: "/analytics/match-strategy", label: "Match Strategy" },
  { href: "/analytics/drive-reflection", label: "Drive Reflection" },
  { href: "/analytics/helper", label: "Helper Reports" },
  { divider: true },
  { href: "/analytics/team-averages", label: "Team Averages" },
  { href: "/analytics/match-breakdown", label: "Match Breakdown" },
  { href: "/analytics/rankings", label: "Rankings" },
  { href: "/analytics/pick-list", label: "Pick List" },
];

export default function AnalyticsShell({
  children,
  entriesCount,
  selectedGame,
  onSelectedGameChange,
  allowedGames = ["REEFSCAPE", "REBUILT"],
  practiceMatchesOnly = false,
  onPracticeMatchesOnlyChange,
  selectedEvent,
  eventOptions = [],
  onSelectedEventChange,
}: AnalyticsShellProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    const saved = localStorage.getItem("analytics-sidebar-collapsed");
    if (saved !== null) return saved === "true";
    return window.innerWidth < 1024;
  });

  useEffect(() => {
    localStorage.setItem("analytics-sidebar-collapsed", String(collapsed));
  }, [collapsed]);

  const effectiveEventOptions = (() => {
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
      if (!practiceMatchesOnly) {
        return withoutWeek0;
      }

      const week0 = eventOptions.find((option) => option.id === "2026week0") || { id: "2026week0", name: "Week 0" };
      const arkansasIndex = withoutWeek0.findIndex((option) => option.id === "2026arli");
      if (arkansasIndex >= 0) {
        return [
          ...withoutWeek0.slice(0, arkansasIndex),
          week0,
          ...withoutWeek0.slice(arkansasIndex),
        ];
      }
      return [week0, ...withoutWeek0];
    }

    return eventOptions;
  })();

  useEffect(() => {
    if (allowedGames.length === 0) return;
    if (!allowedGames.includes(selectedGame)) {
      onSelectedGameChange(allowedGames[0]);
    }
  }, [allowedGames, onSelectedGameChange, selectedGame]);

  useEffect(() => {
    if (!onSelectedEventChange || !selectedEvent) return;
    if (effectiveEventOptions.length === 0) return;
    const exists = effectiveEventOptions.some((option) => option.id === selectedEvent);
    if (!exists) onSelectedEventChange(effectiveEventOptions[0].id);
  }, [effectiveEventOptions, onSelectedEventChange, selectedEvent]);

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 flex h-screen overflow-hidden">
        <aside
          className={`bg-white border-r border-gray-200 shrink-0 transition-all duration-300 ${
            collapsed ? "w-0 overflow-hidden" : "w-64"
          }`}
        >
          <div className="p-4 border-b border-gray-200">
            <h2 className="text-lg font-bold" style={{ color: "var(--primary-color)" }}>
              Analytics
            </h2>
            {effectiveEventOptions.length > 0 && onSelectedEventChange && (
              <div className="mt-3">
                <label className="block text-xs font-semibold text-gray-600 mb-1">Event</label>
                <select
                  value={selectedEvent}
                  onChange={(event) => onSelectedEventChange(event.target.value)}
                  className="w-full border rounded px-2 py-1.5 text-sm"
                >
                  {effectiveEventOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <nav className="p-3 space-y-1">
            {analyticsLinks.map((item, index) => {
              if ("divider" in item) {
                return <hr key={`divider-${index}`} className="my-2 border-gray-300" />;
              }
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`block px-3 py-2 rounded text-sm ${
                    active
                      ? "theme-primary-solid text-white font-semibold"
                      : "text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </aside>

        <div className="flex-1 flex flex-col overflow-hidden">
          <button
            onClick={() => setCollapsed((v) => !v)}
            className="md:hidden fixed right-4 top-4 z-50 px-3 py-2 rounded border border-gray-200 bg-white shadow hover:bg-gray-100"
            title={collapsed ? "Expand analytics sidebar" : "Collapse analytics sidebar"}
            aria-label={collapsed ? "Expand analytics sidebar" : "Collapse analytics sidebar"}
          >
            {collapsed ? ">" : "<"}
          </button>
          <div className="bg-white border-b border-gray-200 p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setCollapsed((v) => !v)}
                className="hidden md:inline-block px-2 py-1 rounded border border-gray-200 hover:bg-gray-100"
                title={collapsed ? "Expand analytics sidebar" : "Collapse analytics sidebar"}
              >
                {collapsed ? ">" : "<"}
              </button>
              <span className="text-sm text-gray-600">{entriesCount} entries</span>
            </div>
            <div className="flex items-center gap-2">
              {onPracticeMatchesOnlyChange && (
                <label className="text-sm text-gray-600 flex items-center gap-2 mr-3">
                  <input
                    type="checkbox"
                    checked={practiceMatchesOnly}
                    onChange={(event) => onPracticeMatchesOnlyChange(event.target.checked)}
                  />
                  Practice Scouted Matches
                </label>
              )}
              <label className="text-sm text-gray-600">Game:</label>
              <select
                value={selectedGame}
                onChange={(e) => onSelectedGameChange(e.target.value)}
                className="border rounded px-3 py-1.5 text-sm"
              >
                {allowedGames.includes("REEFSCAPE") && <option value="REEFSCAPE">REEFSCAPE</option>}
                {allowedGames.includes("REBUILT") && <option value="REBUILT">REBUILT</option>}
              </select>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-6">{children}</div>
        </div>
      </div>
    </div>
  );
}


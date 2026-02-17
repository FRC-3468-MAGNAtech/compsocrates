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
};

const analyticsLinks = [
  { href: "/analytics", label: "Raw Data" },
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
}: AnalyticsShellProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) setCollapsed(true);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

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
          </div>
          <nav className="p-3 space-y-1">
            {analyticsLinks.map((item) => {
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
          <div className="bg-white border-b border-gray-200 p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setCollapsed((v) => !v)}
                className="px-2 py-1 rounded border border-gray-200 hover:bg-gray-100"
                title={collapsed ? "Expand analytics sidebar" : "Collapse analytics sidebar"}
              >
                {collapsed ? ">" : "<"}
              </button>
              <span className="text-sm text-gray-600">{entriesCount} entries</span>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600">Game:</label>
              <select
                value={selectedGame}
                onChange={(e) => onSelectedGameChange(e.target.value)}
                className="border rounded px-3 py-1.5 text-sm"
              >
                <option value="REEFSCAPE">REEFSCAPE</option>
                <option value="REBUILT">REBUILT</option>
              </select>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-6">{children}</div>
        </div>
      </div>
    </div>
  );
}

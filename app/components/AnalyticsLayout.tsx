// FILE: app/components/AnalyticsLayout.tsx  
// COMPLETE NEW FILE - Shared layout for all analytics pages

"use client";

import { useState, useEffect, ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Sidebar from "./Sidebar";
import LoadingSpinner from "./LoadingSpinner";

interface AnalyticsLayoutProps {
  currentPage: "analytics" | "team-averages" | "match-breakdown" | "rankings";
  title: string;
  entryCount?: number;
  loading?: boolean;
  selectedGame: string;
  onGameChange: (game: string) => void;
  selectedEvent?: string;
  onEventChange?: (event: string) => void;
  showPractice?: boolean;
  onPracticeToggle?: (show: boolean) => void;
  children: ReactNode;
}

export default function AnalyticsLayout({
  currentPage,
  title,
  entryCount,
  loading = false,
  selectedGame,
  onGameChange,
  selectedEvent,
  onEventChange,
  showPractice,
  onPracticeToggle,
  children
}: AnalyticsLayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Start collapsed on mobile
  useEffect(() => {
    if (window.innerWidth < 768) {
      setSidebarCollapsed(true);
    }
  }, []);

  const pages = [
    { id: "analytics", label: "Raw Data", href: "/analytics" },
    { id: "team-averages", label: "Team Averages", href: "/team-averages" },
    { id: "match-breakdown", label: "Match Breakdown", href: "/match-breakdown" },
    { id: "rankings", label: "Rankings", href: "/rankings" },
  ];

  const events = [
    { key: "all", name: "All Events" },
    { key: "app-testing", name: "App Testing" },
    { key: "rocketCity", name: "Rocket City Regional" },
    { key: "bayou", name: "Bayou Regional" },
  ];

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 p-4 md:p-6 flex-shrink-0">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            {/* Title & Count */}
            <div className="flex items-center gap-4">
              {/* Collapse Button - Next to hamburger on mobile */}
              <button
                onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                className="md:hidden p-2 hover:bg-gray-100 rounded"
                style={{ color: "#c42221" }}
              >
                {sidebarCollapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
              </button>
              
              <div>
                <h1 className="text-2xl md:text-3xl font-bold" style={{ color: "#c42221" }}>
                  {title}
                </h1>
                {entryCount !== undefined && (
                  <p className="text-sm md:text-base text-gray-600">{entryCount} entries</p>
                )}
              </div>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-3">
              {/* Game Selector */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Game</label>
                <select
                  value={selectedGame}
                  onChange={(e) => onGameChange(e.target.value)}
                  className="border rounded-lg px-3 py-2 text-sm"
                >
                  <option value="REEFSCAPE">REEFSCAPE</option>
                  <option value="REBUILT">REBUILT</option>
                </select>
              </div>

              {/* Event Selector */}
              {selectedEvent !== undefined && onEventChange && (
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Event</label>
                  <select
                    value={selectedEvent}
                    onChange={(e) => onEventChange(e.target.value)}
                    className="border rounded-lg px-3 py-2 text-sm"
                  >
                    {events.map(event => (
                      <option key={event.key} value={event.key}>{event.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Practice Toggle */}
              {showPractice !== undefined && onPracticeToggle && (
                <div className="flex items-end">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showPractice}
                      onChange={(e) => onPracticeToggle(e.target.checked)}
                      className="w-4 h-4"
                    />
                    <span className="text-sm font-medium text-gray-700">Show Practice</span>
                  </label>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Content Area with Sidebar */}
        <div className="flex-1 flex overflow-hidden">
          {/* Analytics Sidebar - Collapsible */}
          <div
            className={`bg-white border-r border-gray-200 transition-all duration-300 flex-shrink-0 ${
              sidebarCollapsed ? "w-0 md:w-16" : "w-64"
            } overflow-hidden`}
          >
            <div className="p-4 space-y-2">
              {pages.map(page => {
                const isActive = currentPage === page.id;
                return (
                  <Link
                    key={page.id}
                    href={page.href}
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                      isActive
                        ? "text-white font-semibold"
                        : "text-gray-700 hover:bg-gray-100"
                    }`}
                    style={isActive ? { backgroundColor: "#c42221" } : {}}
                  >
                    {!sidebarCollapsed && <span>{page.label}</span>}
                    {sidebarCollapsed && <span className="text-xs">{page.label[0]}</span>}
                  </Link>
                );
              })}
            </div>

            {/* Desktop Collapse Button */}
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="hidden md:block w-full p-2 hover:bg-gray-50 border-t"
              style={{ color: "#c42221" }}
            >
              {sidebarCollapsed ? <ChevronRight size={20} className="mx-auto" /> : <ChevronLeft size={20} className="mx-auto" />}
            </button>
          </div>

          {/* Main Content */}
          <div className="flex-1 overflow-y-auto p-4 md:p-8">
            {loading ? <LoadingSpinner /> : children}
          </div>
        </div>
      </div>
    </div>
  );
}

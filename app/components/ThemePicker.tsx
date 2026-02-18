"use client";

import { Palette } from "lucide-react";

export default function ThemePicker({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 text-gray-600 ${
        compact ? "w-full px-2 py-2 text-sm" : "px-4 py-3"
      }`}
    >
      <Palette size={18} />
      <div>
        <p className="font-medium text-gray-700">Themes temporarily disabled</p>
        {!compact && <p className="text-xs">Using default red styling for release stability.</p>}
      </div>
    </div>
  );
}

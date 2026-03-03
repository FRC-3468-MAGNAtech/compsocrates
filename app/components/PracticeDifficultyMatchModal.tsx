"use client";

import { useMemo, useState } from "react";
import ReefscapeStyleModal from "@/app/components/ReefscapeStyleModal";

export type PracticeDifficultyModalOption = {
  id: string;
  label: string;
  teamLabel: string;
  progress: "fresh" | "partial" | "complete";
};

export default function PracticeDifficultyMatchModal({
  open,
  onClose,
  difficulty,
  options,
  onPick,
  onRandomize,
}: {
  open: boolean;
  onClose: () => void;
  difficulty: "easy" | "medium" | "hard";
  options: PracticeDifficultyModalOption[];
  onPick: (id: string) => void;
  onRandomize: (visibleIds: string[]) => void;
}) {
  const [searchTerm, setSearchTerm] = useState("");

  const visible = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return options;
    return options.filter((row) => {
      const hay = `${row.label} ${row.teamLabel}`.toLowerCase();
      return hay.includes(term);
    });
  }, [options, searchTerm]);

  const title = `${difficulty.charAt(0).toUpperCase()}${difficulty.slice(1)} Match Select`;

  return (
    <ReefscapeStyleModal open={open} onClose={onClose} step="qualification">
      <h2 className="text-xl font-semibold mb-3" style={{ color: "var(--primary-color)" }}>
        {title}
      </h2>
      <p className="text-sm text-gray-600 mb-3">Search by match or team number, then pick a match.</p>
      <input
        type="text"
        value={searchTerm}
        onChange={(event) => setSearchTerm(event.target.value)}
        placeholder="Search matches/teams"
        className="w-full border rounded p-2 mb-3"
      />
      <div className="max-h-[50vh] overflow-y-auto border rounded">
        {visible.length === 0 ? (
          <p className="p-3 text-sm text-gray-600">No matches found for this search.</p>
        ) : (
          <div className="divide-y">
            {visible.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => {
                  onPick(row.id);
                  onClose();
                }}
                className="w-full p-3 text-left hover:bg-gray-50"
              >
                <p className="font-semibold text-sm">{row.label}</p>
                <p className="text-xs text-gray-600">{row.teamLabel}</p>
                <p className="text-xs text-gray-500 mt-1">
                  Progress: {row.progress}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => {
            onRandomize(visible.map((row) => row.id));
            onClose();
          }}
          className="flex-1 py-2 rounded text-white font-semibold"
          style={{ backgroundColor: "var(--primary-color)" }}
          disabled={visible.length === 0}
        >
          Randomize
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex-1 py-2 rounded border border-gray-300 font-semibold hover:bg-gray-50"
        >
          Close
        </button>
      </div>
    </ReefscapeStyleModal>
  );
}

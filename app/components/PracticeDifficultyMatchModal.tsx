"use client";

import { useMemo, useState } from "react";
import ReefscapeStyleModal from "@/app/components/ReefscapeStyleModal";

export type PracticeDifficultyModalOption = {
  id: string;
  label: string;
  teamLabel: string;
  eventName: string;
  eventKey: string;
  stage: "qualification" | "semifinal" | "finals" | "practice";
  stageNumber: number;
  alliance: "red" | "blue" | "";
  progress: "fresh" | "partial" | "complete";
  difficulty?: "easy" | "medium" | "hard" | "";
};

export default function PracticeDifficultyMatchModal({
  open,
  onClose,
  difficulty,
  options,
  onPick,
  onRandomize,
  titleOverride,
  showDifficultyFilters = false,
  difficultyFilter = "all",
  onDifficultyFilterChange,
}: {
  open: boolean;
  onClose: () => void;
  difficulty: "easy" | "medium" | "hard";
  options: PracticeDifficultyModalOption[];
  onPick: (id: string) => void;
  onRandomize: (visibleIds: string[]) => void;
  titleOverride?: string;
  showDifficultyFilters?: boolean;
  difficultyFilter?: "all" | "easy" | "medium" | "hard";
  onDifficultyFilterChange?: (value: "all" | "easy" | "medium" | "hard") => void;
}) {
  const [searchTerm, setSearchTerm] = useState("");

  const visible = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    const filtered = term
      ? options.filter((row) => {
          const hay = `${row.label} ${row.teamLabel} ${row.eventName}`.toLowerCase();
          return hay.includes(term);
        })
      : options;
    const difficultyFiltered =
      showDifficultyFilters && difficultyFilter !== "all"
        ? filtered.filter((row) => row.difficulty === difficultyFilter)
        : filtered;
    const progressOrder: Record<PracticeDifficultyModalOption["progress"], number> = {
      fresh: 0,
      partial: 1,
      complete: 2,
    };
    const stageOrder: Record<PracticeDifficultyModalOption["stage"], number> = {
      qualification: 0,
      semifinal: 1,
      finals: 2,
      practice: 3,
    };
    const allianceOrder: Record<NonNullable<PracticeDifficultyModalOption["alliance"]>, number> = {
      red: 0,
      blue: 1,
      "": 2,
    };
    const difficultyOrder: Record<string, number> = {
      easy: 0,
      medium: 1,
      hard: 2,
      "": 3,
      undefined: 3,
    };
    const yearFromKey = (key: string) => {
      const year = Number(String(key || "").trim().slice(0, 4));
      return Number.isFinite(year) ? year : 0;
    };
    return [...difficultyFiltered].sort((a, b) => {
      if (showDifficultyFilters && difficultyFilter === "all") {
        const diffRank = (difficultyOrder[a.difficulty ?? ""] ?? 3) - (difficultyOrder[b.difficulty ?? ""] ?? 3);
        if (diffRank !== 0) return diffRank;
      }
      const diff = progressOrder[a.progress] - progressOrder[b.progress];
      if (diff !== 0) return diff;
      const yearDiff = yearFromKey(a.eventKey) - yearFromKey(b.eventKey);
      if (yearDiff !== 0) return yearDiff;
      const stageDiff = stageOrder[a.stage] - stageOrder[b.stage];
      if (stageDiff !== 0) return stageDiff;
      const numberDiff = a.stageNumber - b.stageNumber;
      if (numberDiff !== 0) return numberDiff;
      const allianceDiff = allianceOrder[a.alliance] - allianceOrder[b.alliance];
      if (allianceDiff !== 0) return allianceDiff;
      const eventDiff = a.eventName.localeCompare(b.eventName);
      if (eventDiff !== 0) return eventDiff;
      return a.label.localeCompare(b.label);
    });
  }, [difficultyFilter, options, searchTerm, showDifficultyFilters]);

  const title = titleOverride || `${difficulty.charAt(0).toUpperCase()}${difficulty.slice(1)} Match Select`;

  return (
    <ReefscapeStyleModal open={open} onClose={onClose} step="qualification">
      <h2 className="text-xl font-semibold mb-3" style={{ color: "var(--primary-color)" }}>
        {title}
      </h2>
      <p className="text-sm text-gray-600 mb-3">Search by match or team number, then pick a match.</p>
      {showDifficultyFilters && (
        <div className="flex flex-wrap gap-2 mb-3">
          {(["all", "easy", "medium", "hard"] as const).map((option) => {
            const isActive = difficultyFilter === option;
            return (
              <button
                key={option}
                type="button"
                onClick={() => onDifficultyFilterChange?.(option)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${
                  isActive ? "border-indigo-500 bg-indigo-50 text-indigo-800" : "border-gray-300 text-gray-600 hover:bg-gray-50"
                }`}
              >
                {option === "all" ? "All" : option.charAt(0).toUpperCase() + option.slice(1)}
              </button>
            );
          })}
        </div>
      )}
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
                <p className="text-xs text-gray-600">Event: {row.eventName || "Unknown"}</p>
                <p className="text-xs text-gray-600">{row.teamLabel}</p>
                {row.difficulty && (
                  <p className="text-xs text-gray-500">Difficulty: {row.difficulty}</p>
                )}
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

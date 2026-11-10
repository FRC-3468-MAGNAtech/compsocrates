import { csDocToScoutEntry } from "@/data/cs/scouting";
import type { CsDoc } from "@/lib/games/types";
import type { ScoutEntry } from "@/lib/scout-entries";
import type { AnalyticsEntry } from "@/lib/analytics/entries";

// Test-only builders: realistic REBUILT scouting documents run through the real adapter, so the analytics models are tested on
// the same ScoutEntry shape the app produces.

export type RebuiltDocOptions = {
  team?: string;
  match?: string;
  event?: string;
  /** Fuel scored from a scored override (auto / teleop transition / endgame), the simplest way to get exact fuel. */
  autoFuel?: number;
  teleFuel?: number;
  endFuel?: number;
  autoClimb?: boolean;
  status?: string;
  practice?: boolean;
  scout?: string;
  alliance?: "red" | "blue";
  startingPosition?: string;
  submittedAt?: number;
  notes?: string;
};

export function rebuiltDoc(o: RebuiltDocOptions = {}): CsDoc {
  const match = o.match ?? "q1";
  return {
    game: "REBUILT",
    teamId: "T1",
    eventKey: o.event ?? "2026arli",
    matchId: match,
    matchType: match.startsWith("p") ? "practice" : "qualification",
    matchNumber: match.replace(/\D/g, ""),
    teamNumber: o.team ?? "254",
    scoutName: o.scout ?? "Sam",
    scoutId: "u1",
    alliance: o.alliance,
    startingPosition: o.startingPosition ?? "middle",
    auto: { counterOverride: o.autoFuel ?? 0, successfulClimb: o.autoClimb ?? false },
    teleop: { transitionOverride: o.teleFuel ?? 0 },
    endgame: { counterOverride: o.endFuel ?? 0, status: o.status ?? "" },
    incidents: [],
    notes: o.notes ?? "",
    submittedAt: o.submittedAt ?? 1_700_000_000_000,
    ...(o.practice ? { isPracticeScouting: true, practiceMode: "trial", practiceSessionId: "S1" } : {}),
  };
}

export function rebuiltEntry(id: string, o: RebuiltDocOptions = {}): ScoutEntry {
  const entry = csDocToScoutEntry(id, rebuiltDoc(o));
  if (!entry) throw new Error("fixture doc did not become an entry");
  return entry;
}

export function analyticsEntry(id: string, o: RebuiltDocOptions = {}, accuracy: number | null = 90): AnalyticsEntry {
  return { ...rebuiltEntry(id, o), allianceAccuracy: accuracy, isExcluded: false };
}

import { getEventMatches, type TBAMatch } from "@/app/utils/tba-api";
import type { ReefscapeMatchOption } from "@/app/components/ReefscapeMatchSelectModal";

export type TeamTbaAuth = {
  encryptedKey?: string;
  plainKey?: string;
};

export function getTbaScheduleTime(match: TBAMatch): number {
  const value = Number(match.actual_time || match.predicted_time || match.time || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function isTbaMatchCompleted(match: Pick<TBAMatch, "alliances">): boolean {
  const red = Number(match.alliances?.red?.score);
  const blue = Number(match.alliances?.blue?.score);
  return red >= 0 && blue >= 0;
}

export function mapPlayoffToBracketSlot(match: Pick<TBAMatch, "comp_level" | "set_number" | "match_number">): number | null {
  // 2026+ double-elim feeds often encode bracket slot as SF{slot}M1.
  if (match.comp_level === "sf" && match.match_number === 1 && match.set_number >= 1 && match.set_number <= 13) {
    return match.set_number;
  }
  if (match.comp_level === "qf") {
    if (match.match_number === 1 && match.set_number >= 1 && match.set_number <= 4) return match.set_number;
    if (match.match_number === 2 && match.set_number === 1) return 7;
    if (match.match_number === 2 && match.set_number === 2) return 8;
    return null;
  }
  if (match.comp_level === "sf") {
    if (match.match_number === 1 && match.set_number === 1) return 5;
    if (match.match_number === 1 && match.set_number === 2) return 6;
    if (match.match_number === 2 && match.set_number === 1) return 9;
    if (match.match_number === 2 && match.set_number === 2) return 10;
    if (match.match_number === 3 && match.set_number === 1) return 11;
    if (match.match_number === 3 && match.set_number === 2) return 12;
    return null;
  }
  if (match.comp_level === "f") {
    if (match.match_number >= 1 && match.match_number <= 3) return 13 + match.match_number; // 14, 15, 16
    return 14;
  }
  return null;
}

export function mapTbaMatchToModalId(match: Pick<TBAMatch, "comp_level" | "set_number" | "match_number">): string {
  if (match.comp_level === "qm") return `q${match.match_number}`;
  const slot = mapPlayoffToBracketSlot(match);
  if (slot) return `f${slot}`;
  if (match.comp_level === "f") return `f${match.match_number}`;
  return "";
}

function compareTbaMatchesForModal(a: TBAMatch, b: TBAMatch): number {
  const compOrder: Record<string, number> = { qm: 0, qf: 1, sf: 2, f: 3 };
  const levelDiff = (compOrder[a.comp_level] ?? 9) - (compOrder[b.comp_level] ?? 9);
  if (levelDiff !== 0) return levelDiff;
  if (a.set_number !== b.set_number) return a.set_number - b.set_number;
  if (a.match_number !== b.match_number) return a.match_number - b.match_number;
  return getTbaScheduleTime(a) - getTbaScheduleTime(b);
}

export function buildReefscapeModalOptions(matches: TBAMatch[]): ReefscapeMatchOption[] {
  const sorted = [...matches].sort(compareTbaMatchesForModal);
  const byId = new Map<string, ReefscapeMatchOption>();
  sorted.forEach((match) => {
    const id = mapTbaMatchToModalId(match);
    if (!id) return;
    const scheduleTime = getTbaScheduleTime(match);
    if (match.comp_level === "qm") {
      const existing = byId.get(id);
      if (!existing || scheduleTime < existing.scheduleTime || existing.scheduleTime <= 0) {
        byId.set(id, {
          id,
          type: "qualification",
          label: `Qualification ${match.match_number}`,
          matchNumber: match.match_number,
          scheduleTime,
        });
      }
      return;
    }

    const slot = mapPlayoffToBracketSlot(match);
    if (!slot) return;
    const label = slot <= 13 ? `Match ${slot}` : slot === 14 ? "FINALS" : `Finals ${slot - 13}`;
    const existing = byId.get(id);
    if (!existing || scheduleTime < existing.scheduleTime || existing.scheduleTime <= 0) {
      byId.set(id, {
        id,
        type: "finals",
        label,
        matchNumber: slot,
        scheduleTime,
      });
    }
  });
  return Array.from(byId.values()).sort((a, b) => {
    if (a.type !== b.type) {
      if (a.type === "practice") return -1;
      if (b.type === "practice") return 1;
      if (a.type === "qualification") return -1;
      if (b.type === "qualification") return 1;
    }
    return a.matchNumber - b.matchNumber;
  });
}

export function buildCompletedModalIdsFromTba(matches: TBAMatch[]): Set<string> {
  const completed = new Set<string>();
  matches.forEach((match) => {
    if (!isTbaMatchCompleted(match)) return;
    const id = mapTbaMatchToModalId(match);
    if (id) completed.add(id);
  });
  return completed;
}

export async function fetchEventMatchesWithTeamAuth(eventKey: string, auth?: TeamTbaAuth): Promise<TBAMatch[]> {
  const normalizedEventKey = String(eventKey || "").trim();
  if (!normalizedEventKey) return [];

  const encryptedKey = String(auth?.encryptedKey || "").trim();
  const plainKey = String(auth?.plainKey || "").trim();
  if (encryptedKey || plainKey) {
    try {
      const response = await fetch("/api/tba/matches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventKey: normalizedEventKey, encryptedKey, plainKey }),
      });
      if (response.ok) {
        const payload = (await response.json()) as { matches?: TBAMatch[] };
        if (Array.isArray(payload.matches)) return payload.matches;
      }
    } catch {
      // Fall through to direct helper.
    }
  }

  return getEventMatches(normalizedEventKey);
}

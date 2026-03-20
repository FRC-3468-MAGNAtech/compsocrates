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

export function isTbaMatchCompleted(
  match: Pick<TBAMatch, "alliances" | "actual_time" | "post_result_time" | "score_breakdown" | "winning_alliance">
): boolean {
  const red = Number(match.alliances?.red?.score);
  const blue = Number(match.alliances?.blue?.score);
  if (Number.isFinite(red) && Number.isFinite(blue) && red >= 0 && blue >= 0) return true;
  if (Number(match.actual_time || 0) > 0) return true;
  if (Number(match.post_result_time || 0) > 0) return true;
  if (match.winning_alliance === "red" || match.winning_alliance === "blue") return true;
  return Boolean(match.score_breakdown && Object.keys(match.score_breakdown || {}).length > 0);
}

export function mapPlayoffToBracketSlot(
  match: Pick<TBAMatch, "comp_level" | "set_number" | "match_number" | "key">
): number | null {
  const key = String(match.key || "").toLowerCase();
  const inferredLevel =
    String(match.comp_level || "").toLowerCase() ||
    (/_qf\d+m\d+/.test(key) ? "qf" : "") ||
    (/_sf\d+m\d+/.test(key) ? "sf" : "") ||
    (/_f\d+m\d+/.test(key) ? "f" : "");
  const setNumber = Number(match.set_number || 0);
  const matchNumber = Number(match.match_number || 0);

  // 2026+ double-elim feeds often encode bracket slot as SF{slot}M{n}.
  if (inferredLevel === "sf" && setNumber >= 1 && setNumber <= 13) {
    return setNumber;
  }
  if (inferredLevel === "qf") {
    if (setNumber >= 1 && setNumber <= 4) return setNumber;
    if (matchNumber >= 2 && setNumber === 1) return 7;
    if (matchNumber >= 2 && setNumber === 2) return 8;
    return null;
  }
  if (inferredLevel === "sf") {
    if (matchNumber === 1 && setNumber === 1) return 5;
    if (matchNumber === 1 && setNumber === 2) return 6;
    if (matchNumber === 2 && setNumber === 1) return 9;
    if (matchNumber === 2 && setNumber === 2) return 10;
    if (matchNumber === 3 && setNumber === 1) return 11;
    if (matchNumber === 3 && setNumber === 2) return 12;
    return null;
  }
  return null;
}

function parseFinalsSeriesNumber(match: Pick<TBAMatch, "key" | "set_number" | "match_number">): number {
  const key = String(match.key || "");
  const matchKey = key.match(/_f(\d+)m(\d+)/i);
  if (matchKey) {
    const setNum = Number(matchKey[1]);
    const matchNum = Number(matchKey[2]);
    if (setNum >= 14 && setNum <= 16) return setNum - 13;
    if (setNum === 1 && matchNum >= 1 && matchNum <= 3) return matchNum;
    if (setNum >= 1 && setNum <= 3 && matchNum === 1) return setNum;
  }
  const setNum = Number(match.set_number || 0);
  const matchNum = Number(match.match_number || 0);
  if (setNum >= 14 && setNum <= 16) return setNum - 13;
  if (setNum >= 1 && setNum <= 3 && matchNum === 1) return setNum;
  if (matchNum >= 1 && matchNum <= 3) return matchNum;
  return matchNum || 1;
}

export function mapTbaMatchToModalId(match: Pick<TBAMatch, "comp_level" | "set_number" | "match_number" | "key">): string {
  if (match.comp_level === "pr") return `p${match.match_number}`;
  if (match.comp_level === "qm") return `q${match.match_number}`;
  if (match.comp_level === "f") return `f${parseFinalsSeriesNumber(match)}`;
  const slot = mapPlayoffToBracketSlot(match);
  if (slot) return `sf${slot}`;
  return "";
}

function compareTbaMatchesForModal(a: TBAMatch, b: TBAMatch): number {
  const compOrder: Record<string, number> = { pr: 0, qm: 1, qf: 2, sf: 3, f: 4 };
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
    if (match.comp_level === "pr") {
      const existing = byId.get(id);
      if (!existing || scheduleTime < existing.scheduleTime || existing.scheduleTime <= 0) {
        byId.set(id, {
          id,
          type: "practice",
          label: `Practice ${match.match_number}`,
          matchNumber: match.match_number,
          scheduleTime,
        });
      }
      return;
    }
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

    if (match.comp_level === "f") {
      const seriesNumber = parseFinalsSeriesNumber(match);
      const existing = byId.get(id);
      if (!existing || scheduleTime < existing.scheduleTime || existing.scheduleTime <= 0) {
        byId.set(id, {
          id,
          type: "finals",
          finalsKind: "series",
          label: `Finals ${seriesNumber}`,
          matchNumber: seriesNumber,
          scheduleTime,
        });
      }
      return;
    }

    const slot = mapPlayoffToBracketSlot(match);
    if (!slot) return;
    const label = `Match ${slot}`;
    const existing = byId.get(id);
    if (!existing || scheduleTime < existing.scheduleTime || existing.scheduleTime <= 0) {
      byId.set(id, {
        id,
        type: "finals",
        finalsKind: "bracket",
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

export function buildCompletedModalIdsFromTba(matches: TBAMatch[], _nowSec?: number): Set<string> {
  const completed = new Set<string>();

  matches.forEach((match) => {
    const id = mapTbaMatchToModalId(match);
    if (!id) return;
    if (isTbaMatchCompleted(match)) {
      completed.add(id);
    }
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

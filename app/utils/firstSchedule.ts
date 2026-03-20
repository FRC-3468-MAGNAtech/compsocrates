export type FirstScheduleTeam = {
  teamNumber: number;
  station: string;
};

export type FirstScheduleMatch = {
  matchNumber: number;
  startTime: number;
  tournamentLevel: string;
  teams: FirstScheduleTeam[];
  redScore?: number;
  blueScore?: number;
};

type FirstSchedulePayload = {
  schedule?: Array<Record<string, unknown>>;
};

function normalizeStation(team: Record<string, unknown>): string {
  const direct = String(team.station || team.teamStation || team.stationId || "").trim();
  if (direct) return direct;
  const color = String(team.stationColor || team.color || team.alliance || "").trim();
  const number = String(team.stationNumber || team.stationNum || team.position || "").trim();
  if (color) return `${color}${number || ""}`.trim();
  return "";
}

function parseStartTime(raw: unknown): number {
  if (typeof raw === "number") {
    if (raw > 1_000_000_000_000) return Math.floor(raw / 1000);
    if (raw > 1_000_000_000) return Math.floor(raw);
  }
  const parsed = Date.parse(String(raw || ""));
  if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000);
  return 0;
}

function parseScoreValue(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function readScore(row: Record<string, unknown>, alliance: "red" | "blue"): number | null {
  const upper = alliance === "red" ? "Red" : "Blue";
  const candidates = [
    `score${upper}Final`,
    `score${upper}FinalScore`,
    `score${upper}FinalPoints`,
    `score${upper}`,
    `${alliance}Score`,
    `${alliance}FinalScore`,
    `${alliance}ScoreFinal`,
    `${upper}Score`,
    `${upper}FinalScore`,
  ];
  for (const key of candidates) {
    const value = parseScoreValue(row[key]);
    if (value !== null) return value;
  }
  const allianceBlock = row.alliances || (row as Record<string, unknown>).Alliances;
  if (allianceBlock && typeof allianceBlock === "object") {
    const block = allianceBlock as Record<string, unknown>;
    const entry = (block[alliance] || block[upper]) as Record<string, unknown> | undefined;
    if (entry && typeof entry === "object") {
      const value = parseScoreValue(
        (entry as Record<string, unknown>).score ??
          (entry as Record<string, unknown>).finalScore ??
          (entry as Record<string, unknown>).totalScore ??
          (entry as Record<string, unknown>).totalPoints
      );
      if (value !== null) return value;
    }
  }
  const flatAllianceScore = parseScoreValue(
    row[`${alliance}AllianceScore`] ?? row[`${upper}AllianceScore`]
  );
  if (flatAllianceScore !== null) return flatAllianceScore;
  return null;
}

export function getFirstEventCodeFromTbaKey(key: string): string {
  const normalized = String(key || "").toLowerCase();
  const specialMap: Record<string, string> = {
    "2026labr": "LAKE",
    "2025lake": "LAKE",
  };
  if (specialMap[normalized]) return specialMap[normalized];
  const suffix = normalized.slice(4).toUpperCase();
  return suffix || normalized.toUpperCase();
}

export async function fetchFirstSchedule(eventKey: string, tournamentLevel = "Practice"): Promise<FirstScheduleMatch[]> {
  const safeEventKey = String(eventKey || "").trim();
  if (!safeEventKey) return [];
  const year = Number(safeEventKey.slice(0, 4));
  if (!Number.isFinite(year)) return [];
  const eventCode = getFirstEventCodeFromTbaKey(safeEventKey);

  try {
    const response = await fetch("/api/first/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ year, eventCode, tournamentLevel }),
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as FirstSchedulePayload & Record<string, unknown>;
    const rows = Array.isArray(payload.schedule)
      ? payload.schedule
      : Array.isArray((payload as Record<string, unknown>).Schedule)
      ? ((payload as Record<string, unknown>).Schedule as Array<Record<string, unknown>>)
      : Array.isArray((payload as Record<string, unknown>).matches)
      ? ((payload as Record<string, unknown>).matches as Array<Record<string, unknown>>)
      : [];
    return rows
      .map((row) => {
        const matchNumber = Number(row.matchNumber ?? row.match_number ?? row.match ?? row.matchNo ?? 0);
        const startTime = parseStartTime(row.startTime ?? row.startTimeLocal ?? row.startTimeUTC ?? row.time ?? row.matchTime);
        const tournament = String(
          row.tournamentLevel ?? row.tournament_level ?? row.level ?? row.matchType ?? row.match_type ?? ""
        ).trim();
        const teamsRaw = Array.isArray(row.teams)
          ? row.teams
          : Array.isArray((row as Record<string, unknown>).Teams)
          ? ((row as Record<string, unknown>).Teams as Array<Record<string, unknown>>)
          : [];
        const teams = teamsRaw
          .map((team) => {
            const teamNumber = Number((team as Record<string, unknown>).teamNumber ?? (team as Record<string, unknown>).team ?? 0);
            const station = normalizeStation(team as Record<string, unknown>);
            return { teamNumber, station };
          })
          .filter((team) => Number.isFinite(team.teamNumber) && team.teamNumber > 0);
        const redScore = readScore(row, "red");
        const blueScore = readScore(row, "blue");
        return {
          matchNumber,
          startTime,
          tournamentLevel: tournament,
          teams,
          redScore: redScore ?? undefined,
          blueScore: blueScore ?? undefined,
        };
      })
      .filter((row) => Number.isFinite(row.matchNumber) && row.matchNumber > 0);
  } catch (error) {
    console.warn("Failed to fetch FIRST schedule:", error);
    return [];
  }
}

export function splitFirstAllianceTeams(match: FirstScheduleMatch): { red: number[]; blue: number[] } {
  const red: number[] = [];
  const blue: number[] = [];

  match.teams.forEach((team) => {
    const station = String(team.station || "").trim().toLowerCase();
    if (station.startsWith("r") || station.includes("red")) {
      red.push(team.teamNumber);
      return;
    }
    if (station.startsWith("b") || station.includes("blue")) {
      blue.push(team.teamNumber);
      return;
    }
  });

  return { red, blue };
}

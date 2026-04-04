"use client";

import { useMemo } from "react";
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  type TooltipProps,
} from "recharts";
import { getRebuiltFuelBreakdown, type RebuiltScoringEntry } from "@/app/utils/analyticsScoring";

type RebuiltEntry = RebuiltScoringEntry & {
  teamNumber?: string;
};

type LeadScoutEntry = {
  robots?: Array<{
    teamNumber?: string;
    skillLevel?: number;
  }>;
  overallAlliance?: {
    skillLevel?: number;
  };
};

type RadarDatum = {
  metric: string;
  fullLabel: string;
  valueA: number;
  valueB?: number;
  overlap?: number;
};

type TeamStat = {
  teamNumber: string;
  autoAvg: number;
  activeFuelAvg: number;
  totalFuelAvg: number;
  hubIq: number;
  towerAvg: number;
  agilityAvg: number;
};

type RobotRadarChartProps = {
  entries: RebuiltEntry[];
  leadEntries?: LeadScoutEntry[];
  teamNumbers: [string] | [string, string];
  teamColors?: Record<string, string>;
  height?: number;
  className?: string;
};

const METRICS = [
  { key: "auto", label: "Auto Prowess", full: "Auto Prowess" },
  { key: "volume", label: "Hub Volume", full: "Hub Volume" },
  { key: "iq", label: "Hub IQ", full: "Hub IQ (Efficiency)" },
  { key: "tower", label: "Tower Power", full: "Tower Power" },
  { key: "agility", label: "Agility", full: "Agility / Defense" },
] as const;

const DEFAULT_COLORS = ["#be123c", "#2563eb"];

function clamp10(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(10, value));
}

function towerScore(status?: string) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "level-3") return 10;
  if (normalized === "level-2") return 6;
  if (normalized === "level-1") return 3;
  return 0;
}

function resolveSkillLevel(entry: LeadScoutEntry, teamNumber: string) {
  const match = entry.robots?.find((robot) => String(robot.teamNumber || "").trim() === teamNumber);
  if (typeof match?.skillLevel === "number") return match.skillLevel;
  if (typeof entry.overallAlliance?.skillLevel === "number") return entry.overallAlliance.skillLevel;
  return null;
}

function RadarTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload as RadarDatum | undefined;
  if (!row) return null;
  return (
    <div className="bg-white border border-gray-200 rounded px-3 py-2 text-xs shadow">
      <div className="font-semibold text-gray-900">{row.fullLabel}</div>
      {"valueA" in row && <div className="text-gray-700">Team A: {row.valueA.toFixed(1)}</div>}
      {typeof row.valueB === "number" && <div className="text-gray-700">Team B: {row.valueB.toFixed(1)}</div>}
    </div>
  );
}

export default function RobotRadarChart({
  entries,
  leadEntries = [],
  teamNumbers,
  teamColors = {},
  height = 360,
  className,
}: RobotRadarChartProps) {
  const [teamA, teamB] = teamNumbers;

  const teamStats = useMemo(() => {
    const byTeam = new Map<string, {
      autoPoints: number[];
      activeFuel: number[];
      totalFuel: number[];
      tower: number[];
    }>();

    entries.forEach((entry) => {
      const teamNumber = String(entry.teamNumber || "").trim();
      if (!teamNumber) return;
      const fuel = getRebuiltFuelBreakdown(entry);
      const autoClimb = entry.auto?.successfulClimb ? 15 : 0;
      const autoPoints = fuel.autoFuel + autoClimb;
      const activeFuel = fuel.teleFuel;
      const totalFuel = fuel.autoFuel + fuel.teleFuel + fuel.endgameFuel;
      const tower = towerScore(entry.endgame?.status);
      const bucket = byTeam.get(teamNumber) || { autoPoints: [], activeFuel: [], totalFuel: [], tower: [] };
      bucket.autoPoints.push(autoPoints);
      bucket.activeFuel.push(activeFuel);
      bucket.totalFuel.push(totalFuel);
      bucket.tower.push(tower);
      byTeam.set(teamNumber, bucket);
    });

    const skillMap = new Map<string, number[]>();
    leadEntries.forEach((entry) => {
      const robots = entry.robots || [];
      robots.forEach((robot) => {
        const team = String(robot.teamNumber || "").trim();
        if (!team) return;
        const level = resolveSkillLevel(entry, team);
        if (typeof level !== "number") return;
        const arr = skillMap.get(team) || [];
        arr.push(level);
        skillMap.set(team, arr);
      });
    });

    const stats = new Map<string, TeamStat>();
    byTeam.forEach((bucket, teamNumber) => {
      const avg = (values: number[]) => (values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0);
      const autoAvg = avg(bucket.autoPoints);
      const activeFuelAvg = avg(bucket.activeFuel);
      const totalFuelAvg = avg(bucket.totalFuel);
      const towerAvg = avg(bucket.tower);
      const skillValues = skillMap.get(teamNumber) || [];
      const agilityAvg = skillValues.length ? avg(skillValues) : 0;
      const hubIq = totalFuelAvg > 0 ? (activeFuelAvg / totalFuelAvg) * 10 : 0;
      stats.set(teamNumber, {
        teamNumber,
        autoAvg,
        activeFuelAvg,
        totalFuelAvg,
        hubIq,
        towerAvg,
        agilityAvg,
      });
    });
    return stats;
  }, [entries, leadEntries]);

  const maxAuto = useMemo(() => {
    let max = 0;
    teamStats.forEach((stat) => {
      max = Math.max(max, stat.autoAvg);
    });
    return max || 1;
  }, [teamStats]);

  const maxActiveFuel = useMemo(() => {
    let max = 0;
    teamStats.forEach((stat) => {
      max = Math.max(max, stat.activeFuelAvg);
    });
    return max || 1;
  }, [teamStats]);

  const statsA = teamStats.get(teamA);
  const statsB = teamB ? teamStats.get(teamB) : undefined;

  const data: RadarDatum[] = useMemo(() => {
    const autoA = clamp10(((statsA?.autoAvg || 0) / maxAuto) * 10);
    const volumeA = clamp10(((statsA?.activeFuelAvg || 0) / maxActiveFuel) * 10);
    const iqA = clamp10(statsA?.hubIq || 0);
    const towerA = clamp10(statsA?.towerAvg || 0);
    const agilityA = clamp10(statsA?.agilityAvg || 0);

    const autoB = clamp10(((statsB?.autoAvg || 0) / maxAuto) * 10);
    const volumeB = clamp10(((statsB?.activeFuelAvg || 0) / maxActiveFuel) * 10);
    const iqB = clamp10(statsB?.hubIq || 0);
    const towerB = clamp10(statsB?.towerAvg || 0);
    const agilityB = clamp10(statsB?.agilityAvg || 0);

    const rows: RadarDatum[] = [
      { metric: METRICS[0].label, fullLabel: METRICS[0].full, valueA: autoA, valueB: statsB ? autoB : undefined },
      { metric: METRICS[1].label, fullLabel: METRICS[1].full, valueA: volumeA, valueB: statsB ? volumeB : undefined },
      { metric: METRICS[2].label, fullLabel: METRICS[2].full, valueA: iqA, valueB: statsB ? iqB : undefined },
      { metric: METRICS[3].label, fullLabel: METRICS[3].full, valueA: towerA, valueB: statsB ? towerB : undefined },
      { metric: METRICS[4].label, fullLabel: METRICS[4].full, valueA: agilityA, valueB: statsB ? agilityB : undefined },
    ];

    if (statsB) {
      rows.forEach((row) => {
        row.overlap = Math.min(row.valueA, row.valueB ?? 0);
      });
    }
    return rows;
  }, [statsA, statsB, maxAuto, maxActiveFuel]);

  const highlightAxes = useMemo(() => {
    if (!statsB) return new Set<string>();
    const set = new Set<string>();
    data.forEach((row) => {
      if (typeof row.valueB !== "number") return;
      if (Math.abs(row.valueA - row.valueB) >= 2) {
        set.add(row.metric);
      }
    });
    return set;
  }, [data, statsB]);

  const colorA = teamColors[teamA] || DEFAULT_COLORS[0];
  const colorB = teamB ? teamColors[teamB] || DEFAULT_COLORS[1] : DEFAULT_COLORS[1];

  if (!statsA) {
    return <div className="text-sm text-gray-600">No REBUILT scouting data available for this team.</div>;
  }

  return (
    <div className={className}>
      <div className="h-full" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={data}>
            <PolarGrid />
            <PolarAngleAxis
              dataKey="metric"
              tick={(props) => {
                const { payload, x, y, textAnchor, dominantBaseline } = props;
                const isHighlight = highlightAxes.has(payload.value);
                return (
                  <text
                    x={x}
                    y={y}
                    textAnchor={textAnchor}
                    dominantBaseline={dominantBaseline}
                    fill={isHighlight ? "#b45309" : "#4b5563"}
                    fontSize={12}
                    fontWeight={isHighlight ? 700 : 500}
                  >
                    {payload.value}
                  </text>
                );
              }}
            />
            <PolarRadiusAxis angle={30} domain={[0, 10]} tickCount={6} />
            <Tooltip content={<RadarTooltip />} />
            {statsB && (
              <Radar dataKey="overlap" stroke="#9ca3af" fill="#9ca3af" fillOpacity={0.25} />
            )}
            <Radar dataKey="valueA" stroke={colorA} fill={colorA} fillOpacity={0.5} />
            {statsB && <Radar dataKey="valueB" stroke={colorB} fill={colorB} fillOpacity={0.5} />}
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

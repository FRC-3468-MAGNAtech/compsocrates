"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { addDoc, collection, doc, getDoc, getDocs, query, setDoc, where } from "firebase/firestore";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Compass,
  Flag,
  Radar,
  RefreshCw,
  Rocket,
  StickyNote,
  Users,
} from "lucide-react";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import ReefscapeMatchSelectModal, { type ReefscapeMatchOption } from "@/app/components/ReefscapeMatchSelectModal";
import { useAuth } from "@/app/AuthContext";
import { getDashboardRoute } from "@/app/utils/dashboardRoute";
import { type TBAMatch } from "@/app/utils/tba-api";
import { resolveDetectedTeamEventKey } from "@/app/utils/eventDetection";
import { getEffectiveNowSec } from "@/app/utils/teamTime";
import { fetchFirstSchedule, splitFirstAllianceTeams } from "@/app/utils/firstSchedule";
import {
  buildCompletedModalIdsFromTba,
  buildReefscapeModalOptions,
  fetchEventMatchesWithTeamAuth,
  mapTbaMatchToModalId,
} from "@/app/utils/reefscapeMatchSync";
import { Action, Chip, CommandBar, Deck, HudCanvas, HudViewport, PageIntro, Surface } from "@/app/components/Hud";

type RobotReflection = {
  teamNumber: string;
  startingPosition: string;
  role: string;
  autoClimb: boolean;
  endgameClimb: string;
};

type MatchOption = {
  key: string;
  label: string;
  scheduleTime: number;
  teams: string[];
  redTeams?: string[];
  blueTeams?: string[];
};

type MatchType = "practice" | "qualification" | "finals";

type ModalMatchOption = ReefscapeMatchOption & {
  sourceKey: string;
};

type StrategyRobot = {
  teamNumber?: string;
  startingPosition?: string;
  role?: string;
  autoClimb?: boolean;
  endgameClimb?: string;
};

type StrategyPlanDoc = {
  id: string;
  eventKey?: string;
  matchKey?: string;
  teamId?: string;
  game?: string;
  createdAt?: number;
  robots?: StrategyRobot[];
};

function strategyDocTime(doc: StrategyPlanDoc) {
  return Number(doc.createdAt || 0);
}

function isUserAttendingEvent(
  attendeesByEvent: Record<string, string[]> | undefined,
  eventKey: string,
  user: { uid?: string | null; displayName?: string | null }
) {
  if (!attendeesByEvent) return false;
  const attendees = attendeesByEvent[eventKey] || [];
  const normalizedUid = String(user.uid || "").trim();
  const normalizedName = String(user.displayName || "").trim().toLowerCase();
  return attendees.some((value) => {
    const safe = String(value || "").trim();
    if (!safe) return false;
    return safe === normalizedUid || safe.toLowerCase() === normalizedName;
  });
}

function buildFallbackDriveMatches(): MatchOption[] {
  const rows: MatchOption[] = [];
  for (let n = 1; n <= 20; n += 1) {
    rows.push({ key: `p${n}`, label: `Practice ${n}`, scheduleTime: 0, teams: [] });
  }
  for (let n = 1; n <= 80; n += 1) {
    rows.push({ key: `q${n}`, label: `Q${n}`, scheduleTime: 0, teams: [] });
  }
  for (let n = 1; n <= 3; n += 1) {
    rows.push({ key: `f${n}`, label: `F${n}`, scheduleTime: 0, teams: [] });
  }
  return rows;
}

function parseTeamNumber(raw: string) {
  const digits = String(raw || "").replace(/\D/g, "");
  return digits ? Number(digits) : 0;
}

function normalizeScoutedMatchId(value: unknown): string {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  const direct = raw.match(/^(p|q|qf|sf|f)(\d+)$/);
  if (direct) return `${direct[1]}${Number(direct[2])}`;
  const playoffSet = raw.match(/^(qf|sf|f)(\d+)m(\d+)$/);
  if (playoffSet) return `${playoffSet[1]}${Number(playoffSet[2])}`;

  const fromQmKey = raw.match(/_qm(\d+)/);
  if (fromQmKey) return `q${Number(fromQmKey[1])}`;
  const fromPracticeKey = raw.match(/_(?:pr|pm)(\d+)/);
  if (fromPracticeKey) return `p${Number(fromPracticeKey[1])}`;
  const fromPractice = raw.match(/practice(?:\s+match)?\s+(\d+)/);
  if (fromPractice) return `p${Number(fromPractice[1])}`;
  const fromQual = raw.match(/qualification(?:\s+match)?\s+(\d+)/);
  if (fromQual) return `q${Number(fromQual[1])}`;

  const sfKey = raw.match(/_sf(\d+)m(\d+)/);
  if (sfKey) return `sf${Number(sfKey[1])}`;
  const sfLabel = raw.match(/semifinal\s+(\d+)(?:-(\d+))?/);
  if (sfLabel) return `sf${Number(sfLabel[1])}`;

  const qfKey = raw.match(/_qf(\d+)m(\d+)/);
  if (qfKey) return `qf${Number(qfKey[1])}`;
  const qfLabel = raw.match(/quarterfinal\s+(\d+)(?:-(\d+))?/);
  if (qfLabel) return `qf${Number(qfLabel[1])}`;

  const finalsKey = raw.match(/_f(\d+)m(\d+)/);
  if (finalsKey) return `f${Number(finalsKey[2])}`;
  const finalsLabel = raw.match(/finals\s+(\d+)/);
  if (finalsLabel) {
    const n = Number(finalsLabel[1]);
    return `f${n >= 14 && n <= 16 ? n - 13 : n}`;
  }
  return raw.replace(/\s+/g, "");
}

async function fetchCompletedMatchIds(eventKey: string, teamId?: string): Promise<Set<string>> {
  const completed = new Set<string>();
  if (!eventKey) return completed;
  const response = await fetch("/api/scout/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventKey, teamId }),
    cache: "no-store",
  });
  if (!response.ok) return completed;
  const payload = (await response.json()) as { completedIds?: string[] };
  (payload.completedIds || []).forEach((id) => {
    const matchId = normalizeScoutedMatchId(id);
    if (matchId) completed.add(matchId);
  });
  return completed;
}

function labelForMatch(match: TBAMatch) {
  if (match.comp_level === "pr") return `Practice ${match.match_number}`;
  if (match.comp_level === "qm") return `Q${match.match_number}`;
  if (match.comp_level === "sf") return `SF${match.set_number}-${match.match_number}`;
  if (match.comp_level === "qf") return `QF${match.set_number}-${match.match_number}`;
  if (match.comp_level === "f") return `F${match.match_number}`;
  return match.key;
}

function extractMatchNumber(option: MatchOption): number {
  const key = String(option.key || "").toLowerCase();
  const fromKey =
    key.match(/_qm(\d+)$/)?.[1] ||
    key.match(/_pr(\d+)$/)?.[1] ||
    key.match(/_sf\d+m(\d+)$/)?.[1] ||
    key.match(/_qf\d+m(\d+)$/)?.[1] ||
    key.match(/_f\d+m(\d+)$/)?.[1];
  if (fromKey) return Number(fromKey);

  const label = String(option.label || "");
  const fromLabel = label.match(/\d+(?:-\d+)?$/)?.[0];
  if (fromLabel) return Number(fromLabel.split("-").pop() || 0);
  return 0;
}

function getMatchType(option: MatchOption): MatchType {
  const rawKey = String(option.key || "").toLowerCase();
  if (rawKey.includes("_qm") || rawKey.startsWith("q")) return "qualification";
  if (rawKey.includes("_pr") || rawKey.startsWith("p")) return "practice";
  if (rawKey.includes("_sf") || rawKey.includes("_qf") || rawKey.includes("_f") || rawKey.startsWith("f")) return "finals";
  const label = String(option.label || "").trim().toLowerCase();
  if (label.startsWith("q")) return "qualification";
  if (label.startsWith("practice")) return "practice";
  if (label.startsWith("f") || label.startsWith("sf") || label.startsWith("qf")) return "finals";
  return "qualification";
}

function displayMatchLabel(option: MatchOption | null): string {
  if (!option) return "No match selected";
  const rawKey = String(option.key || "").toLowerCase();
  const number = extractMatchNumber(option) || 1;
  const type = getMatchType(option);
  if (type === "practice" || rawKey.includes("_pr")) return `Practice Match ${number}`;
  if (type === "qualification") return `Qualification Match ${number}`;
  if (type === "finals") return `Finals ${number}`;
  return option.label || "No match selected";
}

function normalizeText(value: string | undefined) {
  return String(value || "").trim().toLowerCase();
}

function compareRobotToPlan(actual: RobotReflection, planned: StrategyRobot) {
  const mismatches: string[] = [];
  const actualStarting = normalizeText(actual.startingPosition);
  const plannedStarting = normalizeText(planned.startingPosition);
  const plannedStartingAny = plannedStarting === "any" || plannedStarting === "anywhere";
  if (actualStarting && plannedStarting && !plannedStartingAny && actualStarting !== plannedStarting) {
    mismatches.push("Starting Position");
  }
  const actualRole = normalizeText(actual.role);
  const plannedRole = normalizeText(planned.role);
  if (actualRole && plannedRole && actualRole !== plannedRole) {
    mismatches.push("Role");
  }
  if (Boolean(actual.autoClimb) !== Boolean(planned.autoClimb)) {
    mismatches.push("Auto Climb");
  }
  const actualEndgame = normalizeText(actual.endgameClimb);
  const plannedEndgame = normalizeText(planned.endgameClimb);
  if (actualEndgame && plannedEndgame && actualEndgame !== plannedEndgame) {
    mismatches.push("Endgame Climb");
  }
  return mismatches;
}

function MatchPickerModal({
  open,
  onClose,
  matches,
  completed,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  matches: ModalMatchOption[];
  completed: Set<string>;
  onSelect: (key: string) => void;
}) {
  return (
    <ReefscapeMatchSelectModal
      open={open}
      onClose={onClose}
      options={matches}
      completed={completed}
      onPick={(match) => onSelect(match.sourceKey || match.id)}
    />
  );
}

const START_POSITIONS = [
  { value: "", label: "Select Position" },
  { value: "not-there", label: "Not There" },
  { value: "outpost-trench", label: "Outpost Trench" },
  { value: "outpost-side", label: "Outpost Side" },
  { value: "outpost-bump", label: "Outpost Bump" },
  { value: "middle", label: "Middle" },
  { value: "depot-bump", label: "Depot Bump" },
  { value: "depot-side", label: "Depot Side" },
  { value: "depot-trench", label: "Depot Trench" },
];

const ROLES = [
  { value: "", label: "Select Role" },
  { value: "cycler", label: "Cycler" },
  { value: "passer", label: "Passer" },
  { value: "shooter", label: "Shooter" },
  { value: "stealer", label: "Stealer" },
];

const ENDGAME_CLIMBS = [
  { value: "", label: "None" },
  { value: "level-1", label: "Level 1" },
  { value: "level-2", label: "Level 2" },
  { value: "level-3", label: "Level 3" },
];

type RobotMismatch = {
  team: string;
  hasPlanForTeam: boolean;
  startingPosition: boolean;
  role: boolean;
  autoClimb: boolean;
  endgameClimb: boolean;
};

function RobotDeck({
  index,
  robot,
  setRobot,
  mismatch,
  syncedPlan,
  priority,
  offset,
}: {
  index: number;
  robot: RobotReflection;
  setRobot: (value: RobotReflection) => void;
  mismatch: RobotMismatch;
  syncedPlan: StrategyPlanDoc | null;
  priority: "normal" | "high" | "critical";
  offset?: string;
}) {
  const anyMismatch =
    mismatch.startingPosition || mismatch.role || mismatch.autoClimb || mismatch.endgameClimb;
  return (
    <Deck priority={priority} offset={offset} className="flex flex-col gap-4 xl:col-span-4">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 font-display text-2xl text-slate-950">
          <Rocket className="h-5 w-5 text-red-800/70" />
          Robot {index}
        </p>
        {anyMismatch ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-red-300/60 bg-red-50/60 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-red-800">
            <AlertTriangle className="h-3.5 w-3.5" />
            Plan Mismatch
          </span>
        ) : syncedPlan && mismatch.team && mismatch.hasPlanForTeam ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/60 bg-emerald-50/60 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-emerald-800">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Synced
          </span>
        ) : null}
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Team Number</label>
        <input
          className="w-full font-data text-lg"
          value={robot.teamNumber}
          onChange={(e) => setRobot({ ...robot, teamNumber: e.target.value.replace(/[^\d]/g, "") })}
          placeholder="0000"
        />
        {syncedPlan && mismatch.team && !mismatch.hasPlanForTeam && (
          <p className="mt-1.5 text-xs font-semibold text-amber-700">
            No synced match strategy data found for team {mismatch.team} in this match.
          </p>
        )}
      </div>

      <div>
        <label className="mb-1.5 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
          <Compass className="h-3.5 w-3.5" />
          Starting Position
        </label>
        <select
          className="w-full"
          value={robot.startingPosition}
          onChange={(e) => setRobot({ ...robot, startingPosition: e.target.value })}
        >
          {START_POSITIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {mismatch.startingPosition && (
          <p className="mt-1.5 text-xs font-semibold text-red-700">Does not match synced match strategy starting position.</p>
        )}
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Role</label>
        <select className="w-full" value={robot.role} onChange={(e) => setRobot({ ...robot, role: e.target.value })}>
          {ROLES.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {mismatch.role && <p className="mt-1.5 text-xs font-semibold text-red-700">Does not match synced match strategy role.</p>}
      </div>

      <button
        type="button"
        onClick={() => setRobot({ ...robot, autoClimb: !robot.autoClimb })}
        className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition ${
          robot.autoClimb ? "border-amber-400/60 bg-amber-50/60 text-amber-950" : "border-white/70 bg-white/40 text-slate-600"
        }`}
      >
        <span className="text-sm font-bold">Auto Climb</span>
        <span className="font-data text-xs uppercase tracking-[0.14em]">{robot.autoClimb ? "Yes" : "No"}</span>
      </button>
      {mismatch.autoClimb && <p className="text-xs font-semibold text-red-700">Does not match synced match strategy auto climb value.</p>}

      <div>
        <label className="mb-1.5 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
          <Flag className="h-3.5 w-3.5" />
          Endgame Climb
        </label>
        <select
          className="w-full"
          value={robot.endgameClimb}
          onChange={(e) => setRobot({ ...robot, endgameClimb: e.target.value })}
        >
          {ENDGAME_CLIMBS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {mismatch.endgameClimb && (
          <p className="mt-1.5 text-xs font-semibold text-red-700">Does not match synced match strategy endgame climb.</p>
        )}
      </div>
    </Deck>
  );
}

function DriveReflectionFormContent() {
  const { userData, teamTimeOverride } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("editId");
  const editCollectionParam = searchParams.get("editCollection");
  const editMode = Boolean(editId);
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState("");
  const [eventKey, setEventKey] = useState("app-testing");
  const [ourTeamNumber, setOurTeamNumber] = useState("");
  const [showMatchPicker, setShowMatchPicker] = useState(false);
  const [matchOptions, setMatchOptions] = useState<MatchOption[]>([]);
  const [eventTbaMatches, setEventTbaMatches] = useState<TBAMatch[]>([]);
  const [modalCompleted, setModalCompleted] = useState<Set<string>>(new Set());
  const [selectedMatchKey, setSelectedMatchKey] = useState("");
  const [robot1, setRobot1] = useState<RobotReflection>({
    teamNumber: "",
    startingPosition: "",
    role: "",
    autoClimb: false,
    endgameClimb: "",
  });
  const [robot2, setRobot2] = useState<RobotReflection>({
    teamNumber: "",
    startingPosition: "",
    role: "",
    autoClimb: false,
    endgameClimb: "",
  });
  const [robot3, setRobot3] = useState<RobotReflection>({
    teamNumber: "",
    startingPosition: "",
    role: "",
    autoClimb: false,
    endgameClimb: "",
  });
  const [syncedPlan, setSyncedPlan] = useState<StrategyPlanDoc | null>(null);
  const [editEventKey, setEditEventKey] = useState<string | null>(null);
  const [editMatchKey, setEditMatchKey] = useState<string>("");

  useEffect(() => {
    if (!editId) return;
    let isActive = true;
    const editIdValue = editId;
    const collectionName: string = editCollectionParam || "driveScouting";
    async function loadEditEntry() {
      try {
        const snap = await getDoc(doc(db, collectionName, editIdValue));
        if (!snap.exists()) return;
        const data = snap.data() as Record<string, unknown>;
        if (!isActive) return;
        const entryEventKey = String(data.eventKey || "").trim();
        setEditEventKey(entryEventKey || null);
        const entryMatchKey = String(data.matchKey || data.matchLabel || "").trim();
        setEditMatchKey(entryMatchKey);
        const robots = Array.isArray(data.robots) ? data.robots : [];
        const toRobot = (robot: unknown): RobotReflection => {
          if (!robot || typeof robot !== "object") {
            return { teamNumber: "", startingPosition: "", role: "", autoClimb: false, endgameClimb: "" };
          }
          const row = robot as Record<string, unknown>;
          return {
            teamNumber: String(row.teamNumber || ""),
            startingPosition: String(row.startingPosition || ""),
            role: String(row.role || ""),
            autoClimb: Boolean(row.autoClimb),
            endgameClimb: String(row.endgameClimb || ""),
          };
        };
        setRobot1(toRobot(robots[0]));
        setRobot2(toRobot(robots[1]));
        setRobot3(toRobot(robots[2]));
        setNotes(String(data.notes || ""));
      } catch (error) {
        console.error("Failed to load drive reflection edit entry:", error);
      }
    }
    void loadEditEntry();
    return () => {
      isActive = false;
    };
  }, [editId, editCollectionParam]);

  useEffect(() => {
    async function loadMatches() {
      if (!userData?.teamId) {
        setEventKey("app-testing");
        const fallback = buildFallbackDriveMatches();
        setMatchOptions(fallback);
        setSelectedMatchKey(fallback[0]?.key || "");
        return;
      }
      try {
        const overrideEvent = editMode ? editEventKey : null;
        const teamDoc = await getDoc(doc(db, "teams", userData.teamId));
        const teamData = teamDoc.data() as Record<string, unknown> | undefined;
        const assignmentSnap = overrideEvent
          ? null
          : await getDocs(query(collection(db, "matchAssignments"), where("scoutId", "==", userData.uid)));
        const assignedEventCounts = new Map<string, number>();
        assignmentSnap?.docs.forEach((row) => {
          const data = row.data() as Record<string, unknown>;
          const key = String(data.eventKey || "").trim().toLowerCase();
          if (!key) return;
          assignedEventCounts.set(key, (assignedEventCounts.get(key) || 0) + 1);
        });
        const resolvedEvent = overrideEvent ? overrideEvent : await resolveDetectedTeamEventKey(userData.teamId);
        const normalizedResolved = String(resolvedEvent || "").trim().toLowerCase();
        const assignedEvent =
          assignedEventCounts.size === 0
            ? (normalizedResolved || "app-testing")
            : (normalizedResolved && assignedEventCounts.has(normalizedResolved))
              ? normalizedResolved
              : Array.from(assignedEventCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || "app-testing";
        setEventKey(assignedEvent);
        if (assignedEvent === "app-testing") {
          const fallback = buildFallbackDriveMatches();
          setMatchOptions(fallback);
          setSelectedMatchKey(fallback[0]?.key || "");
          return;
        }

        const ourTeam = parseTeamNumber(
          String(teamData?.teamNumber || teamData?.teamName || userData.teamId)
        );
        const ourTeamStr = ourTeam > 0 ? String(ourTeam) : "";
        setOurTeamNumber(ourTeamStr);

        const encryptedKey = String(teamData?.tbaApiKeyEncrypted || "").trim();
        const plainKey = String(teamData?.tbaApiKey || "").trim();
        const attendeesByEvent = (teamData?.eventAttendees || {}) as Record<string, string[]>;
        let matches = await fetchEventMatchesWithTeamAuth(assignedEvent, { encryptedKey, plainKey });
        const firstSchedule = await fetchFirstSchedule(assignedEvent, "Practice");
        const practiceFromFirst = firstSchedule
          .map((match) => {
            const { red, blue } = splitFirstAllianceTeams(match);
            const redScore = typeof match.redScore === "number" && Number.isFinite(match.redScore) ? match.redScore : -1;
            const blueScore = typeof match.blueScore === "number" && Number.isFinite(match.blueScore) ? match.blueScore : -1;
            const hasScore = redScore >= 0 && blueScore >= 0;
            return {
              key: `${assignedEvent}_pr${match.matchNumber}`,
              comp_level: "pr",
              set_number: 1,
              match_number: match.matchNumber,
              alliances: {
                red: { team_keys: red.map((team) => `frc${team}`), score: redScore },
                blue: { team_keys: blue.map((team) => `frc${team}`), score: blueScore },
              },
              time: match.startTime || 0,
              predicted_time: match.startTime || 0,
              actual_time: hasScore && match.startTime ? match.startTime : 0,
            } as TBAMatch;
          })
          .filter((match) => match.alliances.red.team_keys.length >= 3 && match.alliances.blue.team_keys.length >= 3);
        if (practiceFromFirst.length > 0) {
          matches = [...matches.filter((match) => match.comp_level !== "pr"), ...practiceFromFirst];
        }
        setEventTbaMatches(matches);
        const completionNow = getEffectiveNowSec(teamTimeOverride);
        const completedSet = buildCompletedModalIdsFromTba(matches, completionNow);
        try {
          const completedFromForms = await fetchCompletedMatchIds(assignedEvent, userData?.teamId || "");
          completedFromForms.forEach((id) => completedSet.add(id));
        } catch (error) {
          console.warn("Unable to load scouting completions:", error);
        }
        setModalCompleted(completedSet);
        const options: MatchOption[] = matches
          .map((match) => {
            const redTeams = match.alliances.red.team_keys
              .map((key) => key.replace("frc", "").trim())
              .filter(Boolean);
            const blueTeams = match.alliances.blue.team_keys
              .map((key) => key.replace("frc", "").trim())
              .filter(Boolean);
            const teams = [...redTeams, ...blueTeams];
            return {
              key: match.key,
              label: labelForMatch(match),
              scheduleTime: match.actual_time || match.predicted_time || match.time || 0,
              teams,
              redTeams,
              blueTeams,
            };
          })
          .sort((a, b) => a.scheduleTime - b.scheduleTime);
        const resolvedOptions = options.length > 0 ? options : buildFallbackDriveMatches();
        setMatchOptions(resolvedOptions);
        const modalIdByKey = new Map<string, string>();
        matches.forEach((match) => {
          const key = String(match.key || "").trim();
          const id = mapTbaMatchToModalId(match);
          if (!key || !id || modalIdByKey.has(key)) return;
          modalIdByKey.set(key, id);
        });
        const getModalIdForMatch = (match: MatchOption) => {
          const key = String(match.key || "").trim();
          const mapped = modalIdByKey.get(key);
          if (mapped) return mapped;
          const type = getMatchType(match);
          const number = extractMatchNumber(match) || 1;
          if (type === "qualification") return `q${number}`;
          if (type === "practice") return `p${number}`;
          if (type === "finals") return `f${number}`;
          return "";
        };
        const isCompletedMatch = (match: MatchOption) => {
          const modalId = getModalIdForMatch(match);
          return Boolean(modalId && completedSet.has(modalId));
        };
        const assignedMatchKeys = new Set(
          assignmentSnap
            ? assignmentSnap.docs
                .map((row) => row.data() as Record<string, unknown>)
                .filter((row) => String(row.eventKey || "").trim().toLowerCase() === assignedEvent)
                .map((row) => String(row.matchKey || row.matchLabel || "").trim())
                .filter(Boolean)
            : []
        );
        const assignedMatches = resolvedOptions.filter(
          (match) => assignedMatchKeys.has(match.key) || assignedMatchKeys.has(match.label)
        );

        const now = getEffectiveNowSec(teamTimeOverride);
        const graceSeconds = 10 * 60;
        const matchTypeOrder: Record<MatchType, number> = { qualification: 0, practice: 1, finals: 2 };
        const sortByTypeAndNumber = (a: MatchOption, b: MatchOption) => {
          const typeDiff = matchTypeOrder[getMatchType(a)] - matchTypeOrder[getMatchType(b)];
          if (typeDiff !== 0) return typeDiff;
          return extractMatchNumber(a) - extractMatchNumber(b);
        };
        const pickNextBySchedule = (rows: MatchOption[]) => {
          const scheduled = rows
            .map((match) => ({ match, time: Number(match.scheduleTime || 0) }))
            .filter((row) => row.time > 0 && row.time >= now - graceSeconds)
            .sort((a, b) => {
              const typeDiff = matchTypeOrder[getMatchType(a.match)] - matchTypeOrder[getMatchType(b.match)];
              if (typeDiff !== 0) return typeDiff;
              if (a.time !== b.time) return a.time - b.time;
              return extractMatchNumber(a.match) - extractMatchNumber(b.match);
            });
          if (scheduled.length > 0) return scheduled[0]?.match || null;
          return rows
            .slice()
            .sort(sortByTypeAndNumber)[0] || null;
        };
        const pickFirstByNumber = (rows: MatchOption[]) => rows.slice().sort(sortByTypeAndNumber)[0] || null;
        const pickFirstIncomplete = (rows: MatchOption[]) => {
          const ordered = rows.slice().sort(sortByTypeAndNumber);
          return ordered.find((match) => !isCompletedMatch(match)) || null;
        };

        const isAttending = assignedMatchKeys.size > 0 || isUserAttendingEvent(attendeesByEvent, assignedEvent, userData);
        let next: MatchOption | null = null;
        const teamMatches = ourTeamStr ? resolvedOptions.filter((match) => match.teams.includes(ourTeamStr)) : [];
        const teamFirst =
          teamMatches.length > 0
            ? pickNextBySchedule(teamMatches) || pickFirstIncomplete(teamMatches) || pickFirstByNumber(teamMatches)
            : null;
        if (editMode && editMatchKey) {
          next =
            resolvedOptions.find((match) => match.key === editMatchKey) ||
            resolvedOptions.find((match) => match.label === editMatchKey) ||
            null;
        }
        if (!next) {
          if (teamFirst) {
            next = teamFirst;
          } else if (assignedMatches.length > 0) {
            next = pickFirstIncomplete(assignedMatches) || pickNextBySchedule(assignedMatches);
          } else if (!isAttending) {
            next =
              resolvedOptions.find((match) => /_qm1$/i.test(match.key) || /^Q1$/i.test(match.label)) ||
              resolvedOptions.find((match) => /_qm\d+$/i.test(match.key) || /^Q\d+/i.test(match.label)) ||
              resolvedOptions[0] ||
              null;
          } else {
            next = pickFirstIncomplete(resolvedOptions) || pickNextBySchedule(resolvedOptions) || resolvedOptions[0] || null;
          }
        }
        const currentMatch = selectedMatchKey
          ? resolvedOptions.find((match) => match.key === selectedMatchKey) || null
          : null;
        const currentCompleted = currentMatch ? isCompletedMatch(currentMatch) : false;
        const shouldReplace =
          !currentMatch ||
          currentCompleted ||
          (currentMatch && next && getMatchType(currentMatch) === "practice" && getMatchType(next) === "qualification");
        const finalMatch = shouldReplace ? next : currentMatch;
        if (finalMatch) {
          setSelectedMatchKey(finalMatch.key);
          if (shouldReplace && !editMode) {
            setRobotTeamDefaults(finalMatch, ourTeamStr);
          }
        } else {
          setSelectedMatchKey("");
          setRobot1((prev) => ({ ...prev, teamNumber: "" }));
          setRobot2((prev) => ({ ...prev, teamNumber: "" }));
          setRobot3((prev) => ({ ...prev, teamNumber: "" }));
        }
      } catch (error) {
        console.error("Failed to load drive reflection context:", error);
        const fallback = buildFallbackDriveMatches();
        setMatchOptions(fallback);
        setEventTbaMatches([]);
        setModalCompleted(new Set());
        setSelectedMatchKey(fallback[0]?.key || "");
      }
    }

    void loadMatches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userData?.teamId, teamTimeOverride?.enabled, teamTimeOverride?.offsetMs, editMode, editEventKey, editMatchKey]);

  useEffect(() => {
    if (editMode) return;
    if (matchOptions.length === 0) return;
    const matchTypeOrder: Record<MatchType, number> = { qualification: 0, practice: 1, finals: 2 };
    const sortByTypeAndNumber = (a: MatchOption, b: MatchOption) => {
      const typeDiff = matchTypeOrder[getMatchType(a)] - matchTypeOrder[getMatchType(b)];
      if (typeDiff !== 0) return typeDiff;
      return extractMatchNumber(a) - extractMatchNumber(b);
    };
    const isCompleted = (match: MatchOption) => {
      const id = normalizeScoutedMatchId(match.key || match.label);
      return Boolean(id && modalCompleted.has(id));
    };
    const pickFirstIncomplete = (rows: MatchOption[]) => {
      const ordered = rows.slice().sort(sortByTypeAndNumber);
      return ordered.find((match) => !isCompleted(match)) || null;
    };
    const next = pickFirstIncomplete(matchOptions);
    if (!next) return;
    setSelectedMatchKey((currentKey) => {
      const currentMatch = currentKey ? matchOptions.find((match) => match.key === currentKey) || null : null;
      if (!currentMatch) return next.key;
      if (isCompleted(currentMatch)) return next.key;
      return currentKey;
    });
  }, [modalCompleted, matchOptions, editMode]);

  function setRobotTeamDefaults(match: MatchOption, ourTeam: string) {
    const redTeams = match.redTeams && match.redTeams.length > 0 ? match.redTeams : match.teams.slice(0, 3);
    const blueTeams = match.blueTeams && match.blueTeams.length > 0 ? match.blueTeams : match.teams.slice(3, 6);
    let allianceTeams = redTeams.length > 0 ? redTeams : match.teams.slice(0, 3);
    if (ourTeam && blueTeams.includes(ourTeam)) {
      allianceTeams = blueTeams;
    } else if (ourTeam && redTeams.includes(ourTeam)) {
      allianceTeams = redTeams;
    }
    const sorted = ourTeam && allianceTeams.includes(ourTeam)
      ? [ourTeam, ...allianceTeams.filter((team) => team !== ourTeam)]
      : allianceTeams;
    setRobot1((prev) => ({ ...prev, teamNumber: sorted[0] || prev.teamNumber }));
    setRobot2((prev) => ({ ...prev, teamNumber: sorted[1] || prev.teamNumber }));
    setRobot3((prev) => ({ ...prev, teamNumber: sorted[2] || prev.teamNumber }));
  }

  const selectedMatch = useMemo(
    () => matchOptions.find((match) => match.key === selectedMatchKey) || null,
    [matchOptions, selectedMatchKey]
  );
  useEffect(() => {
    async function loadSyncedPlan() {
      if (!selectedMatch || !eventKey) {
        setSyncedPlan(null);
        return;
      }
      const plansSnap = await getDocs(collection(db, "matchStrategyPlans"));
      const plans = plansSnap.docs
        .map((row) => ({ id: row.id, ...row.data() }) as StrategyPlanDoc)
        .filter(
          (row) =>
            String(row.game || "REBUILT").toUpperCase() === "REBUILT" &&
            String(row.eventKey || "").trim() === String(eventKey || "").trim() &&
            String(row.matchKey || "").trim() === String(selectedMatch.key || "").trim() &&
            (!userData?.teamId || !row.teamId || String(row.teamId) === String(userData.teamId))
        )
        .sort((a, b) => strategyDocTime(b) - strategyDocTime(a));
      setSyncedPlan(plans[0] || null);
    }
    void loadSyncedPlan();
  }, [eventKey, selectedMatch, userData?.teamId]);

  const planMismatchMessages = useMemo(() => {
    if (!syncedPlan || !Array.isArray(syncedPlan.robots) || syncedPlan.robots.length === 0) return [];
    const plannedByTeam = new Map<string, StrategyRobot>();
    syncedPlan.robots.forEach((robot) => {
      const key = String(robot.teamNumber || "").trim();
      if (key) plannedByTeam.set(key, robot);
    });
    const actualRobots: RobotReflection[] = [robot1, robot2, robot3];
    const mismatchedTeams: string[] = [];
    actualRobots.forEach((robot) => {
      const key = String(robot.teamNumber || "").trim();
      if (!key) return;
      const planned = plannedByTeam.get(key);
      if (!planned) return;
      const fields = compareRobotToPlan(robot, planned);
      if (fields.length > 0) {
        mismatchedTeams.push(`${key} (${fields.join(", ")})`);
      }
    });
    return mismatchedTeams;
  }, [robot1, robot2, robot3, syncedPlan]);
  const plannedByTeam = useMemo(() => {
    const map = new Map<string, StrategyRobot>();
    if (!syncedPlan || !Array.isArray(syncedPlan.robots)) return map;
    syncedPlan.robots.forEach((robot) => {
      const key = String(robot.teamNumber || "").trim();
      if (key) map.set(key, robot);
    });
    return map;
  }, [syncedPlan]);

  const robotMismatchByIndex = useMemo(
    () =>
      [robot1, robot2, robot3].map((robot) => {
        const team = String(robot.teamNumber || "").trim();
        const planned = team ? plannedByTeam.get(team) : undefined;
        const mismatches = planned ? compareRobotToPlan(robot, planned) : [];
        const mismatchSet = new Set(mismatches);
        return {
          team,
          hasPlanForTeam: Boolean(planned),
          startingPosition: mismatchSet.has("Starting Position"),
          role: mismatchSet.has("Role"),
          autoClimb: mismatchSet.has("Auto Climb"),
          endgameClimb: mismatchSet.has("Endgame Climb"),
        };
      }),
    [plannedByTeam, robot1, robot2, robot3]
  );
  const modalMatchOptions = useMemo<ModalMatchOption[]>(() => {
    if (eventTbaMatches.length > 0) {
      const sourceById = new Map<string, string>();
      [...eventTbaMatches]
        .sort((a, b) => {
          const aTime = Number(a.actual_time || a.predicted_time || a.time || 0);
          const bTime = Number(b.actual_time || b.predicted_time || b.time || 0);
          if (aTime !== bTime) return aTime - bTime;
          return a.match_number - b.match_number;
        })
        .forEach((match) => {
          const id = mapTbaMatchToModalId(match);
          if (!id || sourceById.has(id)) return;
          sourceById.set(id, String(match.key || id));
        });
      return buildReefscapeModalOptions(eventTbaMatches).map((option) => ({
        ...option,
        sourceKey: sourceById.get(option.id) || option.id,
      }));
    }

    const mapped: ModalMatchOption[] = [];
    let finalsIndex = 1;
    for (const match of matchOptions) {
      const rawKey = String(match.key || "").toLowerCase();
      const keyNumber = Number(rawKey.replace(/\D/g, "")) || 0;
      if (rawKey.startsWith("p")) {
        const number = keyNumber || Number(match.label.replace(/\D/g, "")) || 1;
        mapped.push({ id: `p${number}`, label: `Practice ${number}`, type: "practice", matchNumber: number, scheduleTime: match.scheduleTime, sourceKey: match.key });
        continue;
      }
      if (rawKey.startsWith("q")) {
        const number = keyNumber || Number(match.label.replace(/\D/g, "")) || 1;
        mapped.push({ id: `q${number}`, label: `Qualification ${number}`, type: "qualification", matchNumber: number, scheduleTime: match.scheduleTime, sourceKey: match.key });
        continue;
      }
      if (rawKey.startsWith("f")) {
        const number = keyNumber || finalsIndex;
        mapped.push({ id: `f${number}`, label: `Finals ${number}`, type: "finals", matchNumber: number, scheduleTime: match.scheduleTime, sourceKey: match.key });
        finalsIndex = Math.max(finalsIndex, number + 1);
        continue;
      }

      const q = match.label.match(/^Q(\d+)$/i);
      if (q) {
        const number = Number(q[1]);
        mapped.push({ id: `q${number}`, label: `Qualification ${number}`, type: "qualification", matchNumber: number, scheduleTime: match.scheduleTime, sourceKey: match.key });
      } else {
        const finalsLike = match.label.match(/^(?:F|SF|QF)\s*(\d+)(?:[-M](\d+))?$/i);
        if (finalsLike) {
          const number = Number(finalsLike[2] || finalsLike[1] || finalsIndex);
          mapped.push({ id: `f${number}`, label: `Finals ${number}`, type: "finals", matchNumber: number, scheduleTime: match.scheduleTime, sourceKey: match.key });
          finalsIndex = Math.max(finalsIndex, number + 1);
          continue;
        }

        mapped.push({ id: `f${finalsIndex}`, label: match.label, type: "finals", matchNumber: finalsIndex, scheduleTime: match.scheduleTime, sourceKey: match.key });
        finalsIndex += 1;
      }
    }
    return mapped;
  }, [eventTbaMatches, matchOptions]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!userData?.uid) {
      alert("You must be logged in to submit.");
      return;
    }
    if (!selectedMatch) {
      alert("Select a match first.");
      return;
    }
    setSaving(true);
    try {
      if (planMismatchMessages.length > 0) {
        const proceed = window.confirm(
          `Warning: drive reflection does not match synced match strategy plan for this match:\n${planMismatchMessages.join("\n")}\n\nSubmit anyway?`
        );
        if (!proceed) {
          setSaving(false);
          return;
        }
      }

      const payload = {
        eventKey,
        matchKey: selectedMatch.key,
        matchLabel: displayMatchLabel(selectedMatch),
        scoutId: userData.uid,
        scoutName: userData.displayName || "",
        teamId: userData.teamId || "",
        game: "REBUILT",
        robots: [robot1, robot2, robot3],
        notes: notes.trim(),
        createdAt: Date.now(),
        submittedAt: Date.now(),
      };
      if (editMode && editId && editCollectionParam) {
        await setDoc(doc(db, editCollectionParam, editId), payload, { merge: true });
        alert("Drive Reflection Form updated.");
      } else {
        await addDoc(collection(db, "driveScouting"), payload);
        alert("Drive Reflection Form submitted.");
        if (typeof window !== "undefined") {
          window.location.reload();
        }
      }
    } catch (error) {
      console.error("Failed to submit drive reflection form:", error);
      alert("Could not submit form.");
    } finally {
      setSaving(false);
    }
  }

  const dashboardHref = getDashboardRoute(userData);

  return (
    <HudCanvas>
      <CommandBar>
        <Action variant="ghost" onClick={() => router.push(dashboardHref)}>
          <ArrowLeft className="h-4 w-4" />
          Dashboard
        </Action>
        <span className="hidden font-display text-sm text-slate-950 sm:inline">Drive Reflection</span>
        <Chip icon={Users} label="Role" value="Drive Team" tone="crimson" />
      </CommandBar>

      <HudViewport>
        <form onSubmit={submit} className="grid gap-6 xl:grid-cols-12 xl:items-start">
          <div className="xl:col-span-12">
            <PageIntro
              eyebrow="Post-Match Debrief"
              title={editMode ? "Update Drive Reflection" : "Drive Reflection Form"}
              subtitle="Log what your alliance actually ran on the field this match, so the strategy deck can compare intent against reality."
              actions={
                <Chip
                  icon={Radar}
                  label="Match"
                  value={displayMatchLabel(selectedMatch)}
                  tone={selectedMatch ? "gold" : "slate"}
                />
              }
            />
          </div>

          <Deck priority="high" className="xl:col-span-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs font-black uppercase tracking-[0.28em] text-red-900/60">Match &amp; Scout</p>
              <Action type="button" variant="secondary" onClick={() => setShowMatchPicker(true)}>
                <RefreshCw className="h-3.5 w-3.5" />
                Fix Match
              </Action>
            </div>
            <p className="mt-3 font-display text-3xl text-slate-950">{displayMatchLabel(selectedMatch)}</p>

            <div className="mt-4 space-y-2 text-sm">
              {matchOptions.length === 0 && (
                <p className="flex items-center gap-2 font-semibold text-amber-700">
                  <AlertTriangle className="h-4 w-4" />
                  No matches with Team {ourTeamNumber || "your team"} were found at this event. Use manual values if needed.
                </p>
              )}
              {syncedPlan ? (
                <p className="flex items-center gap-2 font-semibold text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" />
                  Detected match strategy form is synced for this match.
                </p>
              ) : (
                <p className="flex items-center gap-2 font-semibold text-amber-700">
                  <AlertTriangle className="h-4 w-4" />
                  No synced match strategy form found for this match yet.
                </p>
              )}
              <p className="text-slate-500">Mismatch alerts appear beneath each robot field below.</p>
            </div>

            <div className="mt-5">
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Scout Name</label>
              <input className="w-full font-data" value={userData?.displayName || ""} disabled />
            </div>
          </Deck>

          <Deck priority={planMismatchMessages.length > 0 ? "critical" : "normal"} className="xl:col-span-5 xl:translate-y-6">
            <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.28em] text-amber-900/70">
              <Radar className="h-3.5 w-3.5" />
              Strategy Sync Status
            </p>
            {planMismatchMessages.length > 0 ? (
              <div className="mt-4 space-y-2">
                <p className="text-sm font-bold text-red-800">Reflection diverges from the synced plan:</p>
                <ul className="space-y-1 font-data text-xs text-red-800">
                  {planMismatchMessages.map((message) => (
                    <li key={message} className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      {message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-600">
                {syncedPlan
                  ? "Everything you have entered so far lines up with the synced strategy plan for this match."
                  : "Once a match strategy plan is synced for this match, differences will surface here in real time."}
              </p>
            )}
          </Deck>

          <RobotDeck
            index={1}
            robot={robot1}
            setRobot={setRobot1}
            mismatch={robotMismatchByIndex[0]}
            syncedPlan={syncedPlan}
            priority="critical"
            offset=""
            key="robot-1"
          />
          <RobotDeck
            index={2}
            robot={robot2}
            setRobot={setRobot2}
            mismatch={robotMismatchByIndex[1]}
            syncedPlan={syncedPlan}
            priority="high"
            offset="xl:translate-y-8"
            key="robot-2"
          />
          <RobotDeck
            index={3}
            robot={robot3}
            setRobot={setRobot3}
            mismatch={robotMismatchByIndex[2]}
            syncedPlan={syncedPlan}
            priority="normal"
            offset="xl:-translate-y-4"
            key="robot-3"
          />

          <Deck priority="normal" className="xl:col-span-4">
            <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.28em] text-red-900/60">
              <StickyNote className="h-4 w-4" />
              Notes
            </p>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className="mt-4 h-56 w-full resize-none"
              placeholder="Optional notes on the alliance, breakdowns, or anything the numbers won't show..."
            />
          </Deck>

          <div className="xl:col-span-8 xl:col-start-5 flex items-center">
            <Surface className="flex w-full flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-display text-xl text-slate-950">
                  {editMode ? "Ready to update this reflection?" : "Ready to submit this reflection?"}
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  Robot data locks in the moment you submit — you can still fix the match above first.
                </p>
              </div>
              <Action type="submit" disabled={saving || !selectedMatch} className="justify-center px-8 py-3.5 text-base sm:w-auto">
                {saving ? "Submitting..." : editMode ? "Update Drive Reflection" : "Submit Drive Reflection"}
              </Action>
            </Surface>
          </div>
        </form>
      </HudViewport>

      <MatchPickerModal
        open={showMatchPicker}
        onClose={() => setShowMatchPicker(false)}
        matches={modalMatchOptions}
        completed={modalCompleted}
        onSelect={(key) => {
          setSelectedMatchKey(key);
          let target = matchOptions.find((match) => match.key === key);
          if (!target) {
            const n = Number(String(key).replace(/\D/g, "")) || 1;
            if (String(key).toLowerCase().startsWith("q")) {
              target = { key: `q${n}`, label: `Q${n}`, scheduleTime: 0, teams: [] };
            } else if (String(key).toLowerCase().startsWith("p")) {
              target = { key: `p${n}`, label: `Practice ${n}`, scheduleTime: 0, teams: [] };
            } else if (String(key).toLowerCase().startsWith("f")) {
              target = { key: `f${n}`, label: `F${n}`, scheduleTime: 0, teams: [] };
            }
            if (target) {
              setMatchOptions((prev) => (prev.some((row) => row.key === target!.key) ? prev : [...prev, target!]));
            }
          }
          if (target) setRobotTeamDefaults(target, ourTeamNumber);
        }}
      />
    </HudCanvas>
  );
}

export default function DriveReflectionFormPage() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["drive-team"]} formKey="drive-scout-form">
      <DriveReflectionFormContent />
    </ProtectedRoute>
  );
}

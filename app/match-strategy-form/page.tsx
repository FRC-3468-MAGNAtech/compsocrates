"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { addDoc, collection, doc, getDoc, getDocs, query, setDoc, where } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import { useAuth } from "@/app/AuthContext";
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
import {
  Action,
  Chip,
  CommandBar,
  Deck,
  HudCanvas,
  HudViewport,
  Surface,
} from "@/app/components/Hud";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronLeft,
  Hourglass,
  NotebookPen,
  Radar,
  Search,
  ShieldAlert,
  Swords,
  X as XIcon,
} from "lucide-react";

type RobotPlan = {
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

type ModalMatchOption = {
  id: string;
  label: string;
  type: MatchType;
  matchNumber: number;
  scheduleTime: number;
  finalsKind?: "bracket" | "series";
  sourceKey: string;
};

type PitCapabilityDoc = {
  teamNumber?: string;
  teamId?: string;
  game?: string;
  eventKey?: string;
  createdAt?: number;
  submittedAt?: number;
  timestamp?: number;
  climbLevel1?: boolean;
  climbLevel2?: boolean;
  climbLevel3?: boolean;
};

const STARTING_POSITIONS = [
  { value: "not-there", label: "Not There" },
  { value: "outpost-trench", label: "Outpost Trench" },
  { value: "outpost-side", label: "Outpost Side" },
  { value: "outpost-bump", label: "Outpost Bump" },
  { value: "middle", label: "Middle" },
  { value: "depot-bump", label: "Depot Bump" },
  { value: "depot-side", label: "Depot Side" },
  { value: "depot-trench", label: "Depot Trench" },
];

const ROLE_OPTIONS = [
  { value: "cycler", label: "Cycler" },
  { value: "passer", label: "Passer" },
  { value: "shooter", label: "Shooter" },
  { value: "stealer", label: "Stealer" },
];

const CLIMB_OPTIONS = [
  { value: "", label: "None" },
  { value: "level-1", label: "Level 1" },
  { value: "level-2", label: "Level 2" },
  { value: "level-3", label: "Level 3" },
];

function buildFallbackMatchStrategyMatches(): MatchOption[] {
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

function canTeamPerformEndgame(level: string, pit?: PitCapabilityDoc): boolean {
  const status = String(level || "").trim().toLowerCase();
  if (!status) return true;
  if (!pit) return true;
  if (status === "level-1") return Boolean(pit.climbLevel1);
  if (status === "level-2") return Boolean(pit.climbLevel2);
  if (status === "level-3") return Boolean(pit.climbLevel3);
  return true;
}

function pitDocTime(doc: PitCapabilityDoc) {
  return Number(doc.createdAt || doc.submittedAt || doc.timestamp || 0);
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

/** Floating glass overlay for match selection — asymmetric type-first, then a scannable match grid. */
function MatchPickerOverlay({
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
  const [step, setStep] = useState<"type" | MatchType>("type");
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (!open) {
      setStep("type");
      setFilter("");
    }
  }, [open]);

  if (!open) return null;

  const rowsForStep =
    step === "type"
      ? []
      : matches
          .filter((match) => match.type === step)
          .sort((a, b) => a.matchNumber - b.matchNumber)
          .filter((match) => !filter || String(match.matchNumber).includes(filter.trim()));

  const nowSec = Math.floor(Date.now() / 1000);
  const graceSeconds = 10 * 60;
  const scheduledNext = rowsForStep
    .filter((row) => row.scheduleTime > 0 && row.scheduleTime >= nowSec - graceSeconds && !completed.has(row.id))
    .sort((a, b) => a.scheduleTime - b.scheduleTime || a.matchNumber - b.matchNumber);
  const resolvedNextNum =
    scheduledNext[0]?.matchNumber ?? rowsForStep.find((row) => !completed.has(row.id))?.matchNumber ?? -1;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto p-4 pt-16 sm:pt-24">
      <div className="fixed inset-0 bg-slate-950/25 backdrop-blur-sm" onClick={onClose} />
      <Surface raised className="relative z-10 w-full max-w-3xl p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {step !== "type" && (
              <button
                type="button"
                onClick={() => setStep("type")}
                className="grid h-9 w-9 place-items-center rounded-full border border-white/70 bg-white/50 text-slate-700 hover:bg-white/80"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            <div>
              <p className="text-xs font-black uppercase tracking-[0.28em] text-red-900/60">Schedule Deck</p>
              <h2 className="mt-1 font-display text-2xl text-slate-950">
                {step === "type" ? "Select Match Type" : `${step[0].toUpperCase()}${step.slice(1)} Matches`}
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-full border border-white/70 bg-white/50 text-slate-700 hover:bg-white/80"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        {step === "type" ? (
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {(["practice", "qualification", "finals"] as MatchType[]).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setStep(type)}
                className="rounded-2xl border border-white/70 bg-white/45 px-4 py-6 text-center font-display text-lg text-slate-950 transition hover:-translate-y-0.5 hover:bg-white/75"
              >
                {type === "practice" ? "Practice" : type === "qualification" ? "Qualification" : "Finals"}
              </button>
            ))}
          </div>
        ) : (
          <>
            <div className="mt-4 flex items-center gap-2 rounded-full border border-amber-300/50 bg-white/50 px-4 py-2">
              <Search className="h-4 w-4 text-slate-500" />
              <input
                value={filter}
                onChange={(event) => setFilter(event.target.value.replace(/[^\d]/g, ""))}
                placeholder="Filter by match number..."
                className="!min-h-0 flex-1 border-0 bg-transparent p-0 shadow-none focus:outline-none"
              />
            </div>
            <div className="mt-4 max-h-[52vh] overflow-y-auto pr-1">
              {rowsForStep.length === 0 ? (
                <p className="p-6 text-center text-sm text-slate-500">No {step} matches were found for this event.</p>
              ) : (
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
                  {rowsForStep.map((match) => {
                    const done = completed.has(match.id);
                    const isBeforeNext = resolvedNextNum > 0 && match.matchNumber < resolvedNextNum;
                    const status = done || isBeforeNext ? "completed" : match.matchNumber === resolvedNextNum ? "next" : "upcoming";
                    const timeString =
                      match.scheduleTime > 0
                        ? new Date(match.scheduleTime * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
                        : "TBD";
                    return (
                      <button
                        key={match.id}
                        type="button"
                        onClick={() => {
                          onSelect(match.sourceKey || match.id);
                          onClose();
                        }}
                        className="relative rounded-2xl border border-white/70 bg-white/45 px-3 py-3 text-left transition hover:-translate-y-0.5 hover:bg-white/75"
                      >
                        <span
                          className={`absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-full text-white ${
                            status === "completed" ? "bg-emerald-600" : status === "next" ? "bg-amber-500" : "bg-red-600"
                          }`}
                        >
                          {status === "completed" ? (
                            <Check className="h-3 w-3" />
                          ) : status === "next" ? (
                            <Hourglass className="h-3 w-3" />
                          ) : (
                            <XIcon className="h-3 w-3" />
                          )}
                        </span>
                        <span className="font-data block text-base font-bold text-slate-950">
                          {step === "finals" ? `F${match.matchNumber}` : match.matchNumber}
                        </span>
                        <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">
                          {timeString}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </Surface>
    </div>
  );
}

function MatchStrategyFormContent() {
  const router = useRouter();
  const { userData, teamTimeOverride } = useAuth();
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
  const [robot1, setRobot1] = useState<RobotPlan>({ teamNumber: "", startingPosition: "", role: "", autoClimb: false, endgameClimb: "" });
  const [robot2, setRobot2] = useState<RobotPlan>({ teamNumber: "", startingPosition: "", role: "", autoClimb: false, endgameClimb: "" });
  const [robot3, setRobot3] = useState<RobotPlan>({ teamNumber: "", startingPosition: "", role: "", autoClimb: false, endgameClimb: "" });
  const [pitByTeam, setPitByTeam] = useState<Record<string, PitCapabilityDoc>>({});
  const [editEventKey, setEditEventKey] = useState<string | null>(null);
  const [editMatchKey, setEditMatchKey] = useState<string>("");

  useEffect(() => {
    if (!editId) return;
    let isActive = true;
    const editIdValue = editId;
    const collectionName: string = editCollectionParam || "matchStrategyPlans";
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
        const toRobot = (robot: unknown): RobotPlan => {
          if (!robot || typeof robot !== "object") return { teamNumber: "", startingPosition: "", role: "", autoClimb: false, endgameClimb: "" };
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
        console.error("Failed to load match strategy edit entry:", error);
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
        const fallback = buildFallbackMatchStrategyMatches();
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
          const fallback = buildFallbackMatchStrategyMatches();
          setMatchOptions(fallback);
          setSelectedMatchKey(fallback[0]?.key || "");
          return;
        }

        const ourTeamNumber = parseTeamNumber(String(teamData?.teamNumber || teamData?.teamName || userData.teamId));
        setOurTeamNumber(ourTeamNumber > 0 ? String(ourTeamNumber) : "");
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
        const resolvedOptions = options.length > 0 ? options : buildFallbackMatchStrategyMatches();
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
        const teamMatches = ourTeamNumber > 0 ? resolvedOptions.filter((match) => match.teams.includes(String(ourTeamNumber))) : [];
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
            setRobotTeamDefaults(finalMatch, ourTeamNumber > 0 ? String(ourTeamNumber) : "");
          }
        } else {
          setSelectedMatchKey("");
          setRobot1((prev) => ({ ...prev, teamNumber: "" }));
          setRobot2((prev) => ({ ...prev, teamNumber: "" }));
          setRobot3((prev) => ({ ...prev, teamNumber: "" }));
        }
      } catch (error) {
        console.error("Failed to load match strategy context:", error);
        const fallback = buildFallbackMatchStrategyMatches();
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

  function setRobotTeamDefaults(match: MatchOption, ourTeamNumber: string) {
    if (!match) return;
    const redTeams = match.redTeams && match.redTeams.length > 0 ? match.redTeams : match.teams.slice(0, 3);
    const blueTeams = match.blueTeams && match.blueTeams.length > 0 ? match.blueTeams : match.teams.slice(3, 6);
    let allianceTeams = redTeams.length > 0 ? redTeams : match.teams.slice(0, 3);
    if (ourTeamNumber && blueTeams.includes(ourTeamNumber)) {
      allianceTeams = blueTeams;
    } else if (ourTeamNumber && redTeams.includes(ourTeamNumber)) {
      allianceTeams = redTeams;
    }
    const sorted = ourTeamNumber && allianceTeams.includes(ourTeamNumber)
      ? [ourTeamNumber, ...allianceTeams.filter((team) => team !== ourTeamNumber)]
      : allianceTeams;

    setRobot1((prev) => ({ ...prev, teamNumber: sorted[0] || prev.teamNumber }));
    setRobot2((prev) => ({ ...prev, teamNumber: sorted[1] || prev.teamNumber }));
    setRobot3((prev) => ({ ...prev, teamNumber: sorted[2] || prev.teamNumber }));
  }

  const selectedMatch = useMemo(() => matchOptions.find((match) => match.key === selectedMatchKey) || null, [matchOptions, selectedMatchKey]);
  const selectedTeamNumbers = useMemo(
    () =>
      [robot1.teamNumber, robot2.teamNumber, robot3.teamNumber]
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    [robot1.teamNumber, robot2.teamNumber, robot3.teamNumber]
  );

  useEffect(() => {
    async function loadPitSync() {
      if (!eventKey || selectedTeamNumbers.length === 0) {
        setPitByTeam({});
        return;
      }
      const pitSnap = await getDocs(collection(db, "pitScouting"));
      const relevant = pitSnap.docs
        .map((row) => row.data() as PitCapabilityDoc)
        .filter(
          (row) =>
            String(row.game || "REBUILT").toUpperCase() === "REBUILT" &&
            String(row.eventKey || "").trim() === String(eventKey || "").trim() &&
            selectedTeamNumbers.includes(String(row.teamNumber || "").trim())
        );
      const latestByTeam: Record<string, PitCapabilityDoc> = {};
      relevant.forEach((row) => {
        const team = String(row.teamNumber || "").trim();
        if (!team) return;
        const prev = latestByTeam[team];
        if (!prev || pitDocTime(row) >= pitDocTime(prev)) latestByTeam[team] = row;
      });
      setPitByTeam(latestByTeam);
    }
    void loadPitSync();
  }, [eventKey, selectedTeamNumbers]);

  const pitSyncWarnings = useMemo(() => {
    const warnings: string[] = [];
    [robot1, robot2, robot3].forEach((robot, index) => {
      const team = String(robot.teamNumber || "").trim();
      if (!team) return;
      const pit = pitByTeam[team];
      if (!pit) return;
      if (!canTeamPerformEndgame(robot.endgameClimb, pit)) {
        warnings.push(`Robot ${index + 1} (${team}) planned ${robot.endgameClimb || "climb"} but pit says unavailable.`);
      }
    });
    return warnings;
  }, [pitByTeam, robot1, robot2, robot3]);
  const pitSyncStatusByRobot = useMemo(
    () =>
      [robot1, robot2, robot3].map((robot) => {
        const team = String(robot.teamNumber || "").trim();
        const pit = team ? pitByTeam[team] : undefined;
        const climbConflict = Boolean(team && pit && !canTeamPerformEndgame(robot.endgameClimb, pit));
        return {
          team,
          hasPitSync: Boolean(pit),
          climbConflict,
        };
      }),
    [pitByTeam, robot1, robot2, robot3]
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

    if (pitSyncWarnings.length > 0) {
      const proceed = window.confirm(`Warning: plan conflicts with pit scouting:\n${pitSyncWarnings.join("\n")}\n\nSubmit anyway?`);
      if (!proceed) return;
    }

    setSaving(true);
    try {
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
        alert("Match Strategy Form updated.");
      } else {
        await addDoc(collection(db, "matchStrategyPlans"), payload);
        alert("Match Strategy Form submitted.");
        if (typeof window !== "undefined") {
          window.location.reload();
        }
      }
    } catch (error) {
      console.error("Failed to submit match strategy form:", error);
      alert("Could not submit form.");
    } finally {
      setSaving(false);
    }
  }

  function handleMatchPick(key: string) {
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
        const finalTarget = target;
        setMatchOptions((prev) => (prev.some((row) => row.key === finalTarget.key) ? prev : [...prev, finalTarget]));
      }
    }
    if (target) setRobotTeamDefaults(target, ourTeamNumber);
  }

  const robots = [
    { title: "Robot 1", state: robot1, set: setRobot1, sync: pitSyncStatusByRobot[0] },
    { title: "Robot 2", state: robot2, set: setRobot2, sync: pitSyncStatusByRobot[1] },
    { title: "Robot 3", state: robot3, set: setRobot3, sync: pitSyncStatusByRobot[2] },
  ] as const;

  return (
    <HudCanvas>
      <CommandBar>
        <button
          type="button"
          onClick={() => router.back()}
          className="flex items-center gap-2 rounded-full py-1.5 pl-3 pr-4 text-sm font-bold text-slate-800 hover:text-red-800"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <Link href="/" className="hidden items-center gap-2 rounded-full py-1.5 pl-2 pr-4 sm:flex">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-red-800 via-red-600 to-amber-300 text-[10px] font-black text-white">
            CS
          </span>
          <span className="font-display text-base text-slate-950">CompSocrates</span>
        </Link>
        <Action variant="secondary" onClick={() => setShowMatchPicker(true)}>
          <Search className="h-4 w-4" />
          Fix Match
        </Action>
      </CommandBar>

      <HudViewport>
        <form onSubmit={submit} className="flex flex-col gap-6">
          {/* Asymmetric header deck: dominant match-context panel, staggered scout-identity satellite */}
          <div className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
            <Deck priority="critical">
              <p className="text-xs font-black uppercase tracking-[0.3em] text-red-900/60">Alliance Huddle</p>
              <h1 className="mt-3 font-display text-4xl text-slate-950 sm:text-5xl">Match Strategy Deck</h1>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <Chip icon={Swords} label="Match" value={displayMatchLabel(selectedMatch)} tone="crimson" />
                <Chip icon={Radar} label="Team" value={ourTeamNumber || "—"} tone="gold" />
              </div>
              {matchOptions.length === 0 && (
                <div className="mt-4 flex items-start gap-2 rounded-2xl border border-amber-300/60 bg-amber-50/60 px-4 py-3 text-sm font-semibold text-amber-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  No matches with Team {ourTeamNumber || "your team"} were found at this event. Use manual values if needed.
                </div>
              )}
            </Deck>

            <Deck priority="high" offset="lg:translate-x-4">
              <p className="text-xs font-black uppercase tracking-[0.28em] text-amber-900/70">Scout</p>
              <h2 className="mt-2 font-display text-2xl text-slate-950">{userData?.displayName || "Unassigned"}</h2>
              <div className="mt-4 flex items-center gap-2 text-sm font-semibold text-emerald-700">
                <Check className="h-4 w-4" />
                Pit form sync is active for this match
              </div>
              <p className="mt-2 text-xs text-slate-500">Conflicts surface below each robot's climb selection.</p>
            </Deck>
          </div>

          {/* Head-to-head robot decks — staggered offsets in place of a rigid three-column row */}
          <div className="grid gap-6 lg:grid-cols-3">
            {robots.map((robot, index) => (
              <Deck
                key={robot.title}
                priority="normal"
                offset={index === 0 ? "lg:-translate-y-2" : index === 2 ? "lg:translate-y-2" : ""}
              >
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-display text-xl text-slate-950">{robot.title}</h2>
                  {robot.sync.team && (
                    <span
                      className={`grid h-7 w-7 place-items-center rounded-full ${
                        robot.sync.hasPitSync ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"
                      }`}
                      title={robot.sync.hasPitSync ? "Pit form synced" : "No pit form synced"}
                    >
                      {robot.sync.hasPitSync ? <Check className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5" />}
                    </span>
                  )}
                </div>

                <label className="mt-4 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                  Team Number
                </label>
                <input
                  className="mt-2 w-full"
                  value={robot.state.teamNumber}
                  onChange={(event) => robot.set({ ...robot.state, teamNumber: event.target.value.replace(/[^\d]/g, "") })}
                />
                {robot.sync.team && !robot.sync.hasPitSync && (
                  <p className="mt-1.5 text-xs font-semibold text-amber-800/80">
                    No pit form synced for team {robot.sync.team} at this event yet.
                  </p>
                )}

                <label className="mt-4 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                  Starting Position
                </label>
                <select
                  className="mt-2 w-full"
                  value={robot.state.startingPosition}
                  onChange={(event) => robot.set({ ...robot.state, startingPosition: event.target.value })}
                >
                  <option value="">Select Position</option>
                  {STARTING_POSITIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>

                <label className="mt-4 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                  Role
                </label>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {ROLE_OPTIONS.map((option) => {
                    const active = robot.state.role === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => robot.set({ ...robot.state, role: option.value })}
                        className={`rounded-xl border px-2.5 py-2 text-xs font-bold transition ${
                          active
                            ? "border-red-800/60 bg-gradient-to-br from-red-700 to-red-900 text-white"
                            : "border-white/70 bg-white/45 text-slate-800 hover:bg-white/70"
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={() => robot.set({ ...robot.state, autoClimb: !robot.state.autoClimb })}
                  className={`mt-4 flex w-full items-center justify-between gap-3 rounded-2xl border px-4 py-2.5 text-left text-sm font-semibold transition ${
                    robot.state.autoClimb
                      ? "border-amber-300/70 bg-amber-50/60 text-amber-950"
                      : "border-white/70 bg-white/40 text-slate-700 hover:bg-white/60"
                  }`}
                >
                  Auto Climb
                  <span
                    className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border ${
                      robot.state.autoClimb ? "border-amber-400 bg-amber-400 text-white" : "border-slate-300 bg-white/60 text-transparent"
                    }`}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </span>
                </button>

                <label className="mt-4 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                  Endgame Climb
                </label>
                <select
                  className="mt-2 w-full"
                  value={robot.state.endgameClimb}
                  onChange={(event) => robot.set({ ...robot.state, endgameClimb: event.target.value })}
                >
                  {CLIMB_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {robot.sync.climbConflict && (
                  <div className="mt-2 flex items-start gap-2 rounded-xl border border-red-300/60 bg-red-50/60 px-3 py-2 text-xs font-semibold text-red-800">
                    <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    Does not match pit capability: selected climb is unavailable for this team.
                  </div>
                )}
              </Deck>
            ))}
          </div>

          {/* Notes satellite + submit action, asymmetric weighting toward notes */}
          <div className="grid gap-6 xl:grid-cols-[0.65fr_1.35fr]">
            <Deck priority="high">
              <div className="flex items-center gap-2.5">
                <NotebookPen className="h-5 w-5 text-red-800" />
                <h2 className="font-display text-2xl text-slate-950">Strategy Notes</h2>
              </div>
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                className="mt-4 h-48 w-full resize-none"
                placeholder="Alliance intent, priority sequencing, defensive assignments..."
              />
            </Deck>

            <Surface className="flex items-center p-5">
              <button
                type="submit"
                disabled={saving || !selectedMatch}
                className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-red-800/50 bg-gradient-to-br from-red-700 to-red-900 px-6 py-3.5 text-base font-bold text-white shadow-[0_16px_50px_rgba(139,0,0,0.32)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? "Submitting..." : editMode ? "Update Match Strategy Form" : "Submit Match Strategy Form"}
              </button>
            </Surface>
          </div>
        </form>
      </HudViewport>

      <MatchPickerOverlay
        open={showMatchPicker}
        onClose={() => setShowMatchPicker(false)}
        matches={modalMatchOptions}
        completed={modalCompleted}
        onSelect={handleMatchPick}
      />
    </HudCanvas>
  );
}

export default function MatchStrategyFormPage() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["lead-strategist"]} formKey="match-strategy-form">
      <MatchStrategyFormContent />
    </ProtectedRoute>
  );
}

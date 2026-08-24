"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import { useAuth } from "@/app/AuthContext";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "@/app/firebase";
import { Check, Hourglass, X as XIcon, PencilLine } from "lucide-react";
import { buildCompletedModalIdsFromTba, fetchEventMatchesWithTeamAuth } from "@/app/utils/reefscapeMatchSync";
import { getEffectiveNowSec } from "@/app/utils/teamTime";
import { getDashboardRoute } from "@/app/utils/dashboardRoute";
import { Action, CommandBar, Chip, Deck, HudCanvas, HudViewport, PageIntro, Surface } from "@/app/components/Hud";

/* -------------------------------------------------------
   GLASS MODAL — floating overlay, heavy blur, animated
   height + fade. Fresh implementation for the HUD language;
   same open/close/animation behavior as the source form.
-------------------------------------------------------- */
function HudModal({
  open,
  onClose,
  step,
  children,
}: {
  open: boolean;
  onClose: () => void;
  step: string;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [height, setHeight] = useState<string | number>("auto");
  const [hasOpened, setHasOpened] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) {
      setMounted(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setVisible(true);
          setHasOpened(true);
        });
      });
    } else {
      setVisible(false);
      setHasOpened(false);
      const timeout = setTimeout(() => setMounted(false), 250);
      return () => clearTimeout(timeout);
    }
  }, [open]);

  useEffect(() => {
    if (contentRef.current) {
      const newHeight = contentRef.current.scrollHeight + "px";
      if (!hasOpened) {
        setHeight(newHeight);
      } else {
        requestAnimationFrame(() => setHeight(newHeight));
      }
    }
  }, [step, mounted, hasOpened, children]);

  if (!mounted) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div
        className={`absolute inset-0 bg-slate-950/30 backdrop-blur-md transition-opacity duration-300 ${visible ? "opacity-100" : "opacity-0"}`}
        onClick={onClose}
      />
      <div
        className={`glass-surface-raised relative w-full rounded-[2rem] transition-all duration-300 ${visible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"} ${
          step === "qualification" ? "max-w-[900px]" : step === "finals" ? "max-w-[1400px]" : "max-w-md"
        }`}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 z-10 rounded-full border border-amber-300/50 bg-white/60 px-3 py-1 text-xs font-bold text-slate-700 backdrop-blur-xl hover:bg-white/80"
        >
          Cancel
        </button>
        <div style={{ height }} className={`overflow-hidden ${hasOpened ? "transition-[height] duration-300 ease-out" : ""}`}>
          <div ref={contentRef} className="p-7">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------
   MATCH BOX — finals bracket node
-------------------------------------------------------- */
type MatchStatus = "completed" | "next" | "upcoming";

interface Match {
  id: number;
  label: string;
  status: MatchStatus;
  bracket?: "upper" | "lower";
  disabled?: boolean;
  forceSelectable?: boolean;
}

type ActivePresetField = {
  id: string;
  type?: string;
  options?: string[];
};

const statusTone: Record<MatchStatus, { border: string; badge: string }> = {
  completed: { border: "border-emerald-500/70", badge: "bg-emerald-600" },
  next: { border: "border-amber-500/70", badge: "bg-amber-500" },
  upcoming: { border: "border-red-500/60", badge: "bg-red-700" },
};

const statusIcon: Record<MatchStatus, React.ReactNode> = {
  completed: <Check size={10} />,
  next: <Hourglass size={10} />,
  upcoming: <XIcon size={10} />,
};

function MatchBox({
  match,
  setSelectedMatch,
}: {
  match: Match;
  setSelectedMatch: (id: number, bracket?: "upper" | "lower") => void;
}) {
  const isDisabled = Boolean(match.disabled) && !match.forceSelectable;
  const tone = statusTone[match.status];

  return (
    <button
      type="button"
      onClick={() => {
        if (isDisabled) return;
        setSelectedMatch(match.id, match.bracket);
      }}
      disabled={isDisabled}
      className={`relative min-h-[62px] w-[120px] rounded-xl border text-left backdrop-blur-xl ${
        isDisabled ? "cursor-not-allowed border-slate-300/60 bg-white/25 opacity-40" : `${tone.border} bg-white/55 hover:bg-white/75`
      }`}
    >
      <div className={`absolute right-1 top-1 inline-flex h-4 w-4 items-center justify-center rounded-full text-white ${tone.badge}`}>
        {statusIcon[match.status]}
      </div>
      <div className="px-2 pb-1 pt-2">
        <div className="text-[11px] font-bold leading-tight text-slate-900">{match.label}</div>
        <div className="mt-1.5 border-t border-amber-300/30 pt-1 text-center font-data text-[10px] text-slate-600">
          {(() => {
            const baseTime = new Date();
            baseTime.setHours(13, 0, 0, 0);
            const matchTime = new Date(baseTime.getTime() + (match.id - 1) * 6 * 60000);
            return matchTime.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
          })()}
        </div>
      </div>
    </button>
  );
}

function FinalsBracket({
  setSelectedMatch,
  completedMatches,
}: {
  setSelectedMatch: (id: number, bracket?: "upper" | "lower") => void;
  completedMatches: Set<string>;
}) {
  const B = { w: 120, h: 62, colGap: 60, row: 90 };
  const col = (c: number) => (B.w + B.colGap) * c;

  const r1_1 = 20;
  const r1_2 = r1_1 + B.row;
  const r1_3 = r1_2 + B.row + 30;
  const r1_4 = r1_3 + B.row;

  const r2_7 = (r1_1 + r1_2 + B.h) / 2 - B.h / 2;
  const r2_8 = (r1_3 + r1_4 + B.h) / 2 - B.h / 2;

  const r3_11 = (r2_7 + r2_8 + B.h) / 2 - B.h / 2;

  const lower_5 = r1_4 + B.row + 50;
  const lower_6 = lower_5 + B.row;

  const lower_9 = lower_5 - 30;
  const lower_10 = lower_6 - 30;

  const lower_12 = (lower_9 + lower_10 + B.h) / 2 - B.h / 2;

  const y13 = lower_9;
  const yFinals = (r3_11 + y13 + B.h) / 2 - B.h / 2;

  const c0 = 0;
  const c1 = col(1);
  const c2 = col(2);
  const c3 = col(3);
  const c4 = col(4);
  const c5 = col(5);

  const join1 = c0 + B.w + 30;
  const join2 = c1 + B.w + 30;
  const join3 = c2 + B.w + 30;
  const join4 = c3 + B.w + 30;
  const join5 = c4 + B.w + 30;

  const height = 600;
  const totalWidth = c5 + B.w;

  return (
    <div className="relative flex w-full justify-center overflow-x-auto py-6">
      <div style={{ width: totalWidth }}>
        <div className="mb-4 flex gap-[60px] pl-0">
          {[1, 2, 3, 4, 5, 6].map((r) => (
            <div key={r} className="text-center text-[11px] font-bold uppercase tracking-[0.18em] text-red-800/70" style={{ width: B.w }}>
              Round {r}
            </div>
          ))}
        </div>

        <div className="relative" style={{ width: totalWidth, height }}>
          <svg className="pointer-events-none absolute inset-0 overflow-visible" width={totalWidth} height={height}>
            <g stroke="#d4af37" strokeOpacity="0.55" strokeWidth="2" fill="none">
              <path d={`M ${c0 + B.w} ${r1_1 + B.h / 2} H ${join1} V ${r1_2 + B.h / 2} H ${c0 + B.w}`} />
              <path d={`M ${join1} ${r2_7 + B.h / 2} H ${c1}`} />
              <path d={`M ${c0 + B.w} ${r1_3 + B.h / 2} H ${join1} V ${r1_4 + B.h / 2} H ${c0 + B.w}`} />
              <path d={`M ${join1} ${r2_8 + B.h / 2} H ${c1}`} />
              <path d={`M ${c1 + B.w} ${r2_7 + B.h / 2} H ${join2} V ${r2_8 + B.h / 2} H ${c1 + B.w}`} />
              <path d={`M ${join2} ${r3_11 + B.h / 2} H ${c3}`} />
              <path d={`M ${c1 + B.w} ${lower_5 + B.h / 2} H ${join2} V ${lower_9 + B.h / 2} H ${c2}`} />
              <path d={`M ${c1 + B.w} ${lower_6 + B.h / 2} H ${join2} V ${lower_10 + B.h / 2} H ${c2}`} />
              <path d={`M ${c2 + B.w} ${lower_9 + B.h / 2} H ${join3} V ${lower_10 + B.h / 2} H ${c2 + B.w}`} />
              <path d={`M ${join3} ${lower_12 + B.h / 2} H ${c3}`} />
              <path d={`M ${c3 + B.w} ${lower_12 + B.h / 2} H ${join4} V ${y13 + B.h / 2} H ${c4}`} />
              <path d={`M ${c3 + B.w} ${r3_11 + B.h / 2} H ${join5} V ${yFinals + B.h / 2} H ${c5}`} />
              <path d={`M ${c4 + B.w} ${y13 + B.h / 2} H ${join5} V ${yFinals + B.h / 2}`} />
            </g>
          </svg>

          <div className="absolute" style={{ left: c0, top: r1_1 }}>
            <MatchBox match={{ id: 1, label: "Match 1", status: completedMatches.has("sf1") ? "completed" : "upcoming", bracket: "upper", disabled: completedMatches.has("sf1") }} setSelectedMatch={setSelectedMatch} />
          </div>
          <div className="absolute" style={{ left: c0, top: r1_2 }}>
            <MatchBox match={{ id: 2, label: "Match 2", status: completedMatches.has("sf2") ? "completed" : "upcoming", bracket: "upper", disabled: completedMatches.has("sf2") }} setSelectedMatch={setSelectedMatch} />
          </div>
          <div className="absolute" style={{ left: c0, top: r1_3 }}>
            <MatchBox match={{ id: 3, label: "Match 3", status: completedMatches.has("sf3") ? "completed" : "upcoming", bracket: "upper", disabled: completedMatches.has("sf3") }} setSelectedMatch={setSelectedMatch} />
          </div>
          <div className="absolute" style={{ left: c0, top: r1_4 }}>
            <MatchBox match={{ id: 4, label: "Match 4", status: completedMatches.has("sf4") ? "completed" : "upcoming", bracket: "upper", disabled: completedMatches.has("sf4") }} setSelectedMatch={setSelectedMatch} />
          </div>

          <div className="absolute" style={{ left: c1, top: r2_7 }}>
            <MatchBox match={{ id: 7, label: "Match 7", status: completedMatches.has("sf7") ? "completed" : "upcoming", bracket: "upper", disabled: completedMatches.has("sf7") }} setSelectedMatch={setSelectedMatch} />
          </div>
          <div className="absolute" style={{ left: c1, top: r2_8 }}>
            <MatchBox match={{ id: 8, label: "Match 8", status: completedMatches.has("sf8") ? "completed" : "next", bracket: "upper", disabled: completedMatches.has("sf8") }} setSelectedMatch={setSelectedMatch} />
          </div>
          <div className="absolute" style={{ left: c1, top: lower_5 }}>
            <MatchBox match={{ id: 5, label: "Match 5", status: completedMatches.has("sf5") ? "completed" : "upcoming", bracket: "lower", disabled: completedMatches.has("sf5") }} setSelectedMatch={setSelectedMatch} />
          </div>
          <div className="absolute" style={{ left: c1, top: lower_6 }}>
            <MatchBox match={{ id: 6, label: "Match 6", status: completedMatches.has("sf6") ? "completed" : "upcoming", bracket: "lower", disabled: completedMatches.has("sf6") }} setSelectedMatch={setSelectedMatch} />
          </div>

          <div className="absolute" style={{ left: c2, top: lower_9 }}>
            <MatchBox match={{ id: 10, label: "Match 10", status: completedMatches.has("sf10") ? "completed" : "upcoming", bracket: "lower", disabled: completedMatches.has("sf10") }} setSelectedMatch={setSelectedMatch} />
          </div>
          <div className="absolute" style={{ left: c2, top: lower_10 }}>
            <MatchBox match={{ id: 9, label: "Match 9", status: completedMatches.has("sf9") ? "completed" : "upcoming", bracket: "lower", disabled: completedMatches.has("sf9") }} setSelectedMatch={setSelectedMatch} />
          </div>

          <div className="absolute" style={{ left: c3, top: r3_11 }}>
            <MatchBox match={{ id: 11, label: "Match 11", status: completedMatches.has("sf11") ? "completed" : "upcoming", bracket: "upper", disabled: completedMatches.has("sf11") }} setSelectedMatch={setSelectedMatch} />
          </div>
          <div className="absolute" style={{ left: c3, top: lower_12 }}>
            <MatchBox match={{ id: 12, label: "Match 12", status: completedMatches.has("sf12") ? "completed" : "upcoming", bracket: "lower", disabled: completedMatches.has("sf12") }} setSelectedMatch={setSelectedMatch} />
          </div>

          <div className="absolute" style={{ left: c4, top: y13 }}>
            <MatchBox match={{ id: 13, label: "Match 13", status: completedMatches.has("sf13") ? "completed" : "upcoming", bracket: "lower", disabled: completedMatches.has("sf13") }} setSelectedMatch={setSelectedMatch} />
          </div>

          <div className="absolute" style={{ left: c5, top: yFinals }}>
            <MatchBox
              match={{
                id: 14,
                label: "FINALS",
                status: completedMatches.has("f1") && completedMatches.has("f2") && completedMatches.has("f3") ? "completed" : "upcoming",
                forceSelectable: true,
              }}
              setSelectedMatch={setSelectedMatch}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------
   MATCH GRID — practice / qualification tile picker
-------------------------------------------------------- */
function MatchGrid({
  rows,
  isMatchCompleted,
  onPick,
  labelPrefix,
}: {
  rows: Array<{ matchNum: number; timeString: string }>;
  isMatchCompleted: (id: string) => boolean;
  onPick: (matchNum: number) => void;
  labelPrefix: string;
}) {
  const idPrefix = labelPrefix === "Practice" ? "p" : "q";
  const statuses = rows.map(({ matchNum, timeString }) => ({
    matchNum,
    timeString,
    done: isMatchCompleted(`${idPrefix}${matchNum}`),
  }));
  const firstOpen = statuses.find((row) => !row.done)?.matchNum ?? -1;

  return (
    <div className="grid max-h-[60vh] grid-cols-3 gap-2 overflow-y-auto pr-1">
      {statuses.map(({ matchNum, done, timeString }) => {
        const status: MatchStatus = done ? "completed" : matchNum === firstOpen ? "next" : "upcoming";
        const tone = statusTone[status];
        return (
          <button
            key={matchNum}
            type="button"
            onClick={() => {
              if (done) return;
              onPick(matchNum);
            }}
            disabled={done}
            className={`relative h-[86px] rounded-xl border p-2 text-left backdrop-blur-xl ${
              done ? "cursor-not-allowed border-slate-300/60 bg-white/25 opacity-40" : `${tone.border} bg-white/55 hover:bg-white/75`
            }`}
          >
            <div className={`absolute left-1 top-1 inline-flex h-4 w-4 items-center justify-center rounded-full text-white ${tone.badge}`}>
              {statusIcon[status]}
            </div>
            <div className="mt-3">
              <div className="text-sm font-bold text-slate-900">
                {labelPrefix} {matchNum}
              </div>
              <div className="font-data text-xs text-slate-600">{timeString}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------
   STEPPER COUNTER
-------------------------------------------------------- */
function Counter({ label, value, onChange }: { label: string; value: number; onChange: (val: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-sm font-semibold text-slate-700">{label}</span>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => onChange(Math.max(0, value - 1))} className="theme-stepper-btn">
          &minus;
        </button>
        <span className="w-8 text-center font-data text-sm font-bold text-slate-900">{value}</span>
        <button type="button" onClick={() => onChange(value + 1)} className="theme-stepper-btn">
          +
        </button>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 text-sm font-bold uppercase tracking-[0.14em] text-red-800/80">{children}</h3>;
}

/* -------------------------------------------------------
   MAIN PAGE
-------------------------------------------------------- */
function ScoutFormContent() {
  const router = useRouter();
  const { userData, teamTimeOverride } = useAuth();
  const showEventWarning = false;
  const [eventKey, setEventKey] = useState("app-testing");

  const [mobileNotesOpen, setMobileNotesOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalStep, setModalStep] = useState<"type" | "practice" | "qualification" | "finals">("type");
  const [finalsStep, setFinalsStep] = useState<"bracket" | "number">("bracket");
  const [activeFormGame, setActiveFormGame] = useState<"REEFSCAPE" | "REBUILT">("REEFSCAPE");
  const [activeFormFields, setActiveFormFields] = useState<ActivePresetField[]>([]);
  const [selectedMatch, setSelectedMatch] = useState<{ id: number; type?: "qualification" | "practice" | "finals"; bracket?: "upper" | "lower" }>({
    id: 0,
    type: undefined,
  });
  const [scoutedMatchCounts, setScoutedMatchCounts] = useState<Record<string, number>>({});
  const [scoutedTeamsByMatch, setScoutedTeamsByMatch] = useState<Record<string, string[]>>({});
  const [apiQualificationMatches, setApiQualificationMatches] = useState<Array<{ matchNum: number; timeString: string }>>([]);
  const [apiPracticeMatches, setApiPracticeMatches] = useState<Array<{ matchNum: number; timeString: string }>>([]);
  const [apiTeamsByMatchId, setApiTeamsByMatchId] = useState<Record<string, string[]>>({});
  const [apiTargetByMatchId, setApiTargetByMatchId] = useState<Record<string, number>>({});
  const [tbaCompletedMatches, setTbaCompletedMatches] = useState<Set<string>>(new Set());

  const [formData, setFormData] = useState({
    scoutName: userData?.displayName || "",
    teamNumber: "",
    startingPosition: "",
    leftStartingZone: false,
    autoCoralMissed: 0,
    autoCoralL1: 0,
    autoCoralL2: 0,
    autoCoralL3: 0,
    autoCoralL4: 0,
    autoAlgaeProcessorMissed: 0,
    autoAlgaeProcessorScored: 0,
    autoAlgaeNetMissed: 0,
    autoAlgaeNetScored: 0,
    teleopCoralMissed: 0,
    teleopCoralL1: 0,
    teleopCoralL2: 0,
    teleopCoralL3: 0,
    teleopCoralL4: 0,
    teleopAlgaeRemoved: false,
    teleopProcessorMissed: 0,
    teleopProcessorScored: 0,
    teleopNetRobotMissed: 0,
    teleopNetRobotScored: 0,
    teleopNetHumanMissed: 0,
    teleopNetHumanScored: 0,
    failedClimb: 0,
    stageStatus: "",
    incidents: [] as string[],
    notes: "",
  });

  useEffect(() => {
    async function loadActivePreset() {
      if (!userData?.teamId) return;
      const teamDoc = await getDoc(doc(db, "teams", userData.teamId));
      if (!teamDoc.exists()) return;
      const activeMatchFormPresetId = teamDoc.data().activeMatchFormPresetId as string | undefined;
      if (!activeMatchFormPresetId) return;
      const presetDoc = await getDoc(doc(db, "formPresets", activeMatchFormPresetId));
      if (!presetDoc.exists()) return;
      const preset = presetDoc.data() as { name?: string; fields?: ActivePresetField[]; game?: "REEFSCAPE" | "REBUILT" };
      setActiveFormGame(preset.game === "REBUILT" ? "REBUILT" : "REEFSCAPE");
      setActiveFormFields(Array.isArray(preset.fields) ? preset.fields : []);
    }
    loadActivePreset();
  }, [userData?.teamId]);

  useEffect(() => {
    async function loadEventSchedule() {
      if (!userData?.teamId) return;
      try {
        const teamDoc = await getDoc(doc(db, "teams", userData.teamId));
        const selectedEvents = (teamDoc.exists() ? teamDoc.data().selectedEvents : []) as string[] | undefined;
        const resolvedEventKey = Array.isArray(selectedEvents) && selectedEvents.length > 0 ? String(selectedEvents[0]) : "app-testing";
        setEventKey(resolvedEventKey);
        if (!resolvedEventKey || resolvedEventKey === "app-testing") {
          setApiQualificationMatches([]);
          setApiPracticeMatches([]);
          setApiTeamsByMatchId({});
          setApiTargetByMatchId({});
          setTbaCompletedMatches(new Set());
          return;
        }

        const encryptedKey = String(teamDoc.data()?.tbaApiKeyEncrypted || "").trim();
        const plainKey = String(teamDoc.data()?.tbaApiKey || "").trim();
        const matches = await fetchEventMatchesWithTeamAuth(resolvedEventKey, { encryptedKey, plainKey });
        const completionNow = getEffectiveNowSec(teamTimeOverride);
        setTbaCompletedMatches(matches.length > 0 ? buildCompletedModalIdsFromTba(matches, completionNow) : new Set());
        const qualification = matches
          .filter((match) => match.comp_level === "qm")
          .sort((a, b) => a.match_number - b.match_number);

        const teamsByMatchId: Record<string, string[]> = {};
        const targetByMatchId: Record<string, number> = {};

        const toDisplay = (epoch: number, fallbackIndex: number) => {
          if (epoch > 0) {
            return new Date(epoch * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
          }
          const base = new Date();
          base.setHours(9, 0, 0, 0);
          return new Date(base.getTime() + fallbackIndex * 7 * 60000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        };

        const mapped = qualification.map((match, index) => {
          const teams = [...match.alliances.red.team_keys, ...match.alliances.blue.team_keys]
            .map((key) => key.replace("frc", "").trim())
            .filter(Boolean);
          const epoch = match.actual_time || match.predicted_time || match.time || 0;
          teamsByMatchId[`q${match.match_number}`] = teams;
          teamsByMatchId[`p${match.match_number}`] = teams;
          targetByMatchId[`q${match.match_number}`] = teams.length || 6;
          targetByMatchId[`p${match.match_number}`] = teams.length || 6;
          return { matchNum: match.match_number, timeString: toDisplay(epoch, index) };
        });

        setApiQualificationMatches(mapped);
        setApiPracticeMatches(mapped);
        setApiTeamsByMatchId(teamsByMatchId);
        setApiTargetByMatchId(targetByMatchId);
      } catch (error) {
        console.error("Unable to load API match schedule:", error);
        setTbaCompletedMatches(new Set());
      }
    }
    void loadEventSchedule();
  }, [userData?.teamId]);

  useEffect(() => {
    async function loadScoutedProgress() {
      const counts: Record<string, number> = {};
      const teamsByMatch = new Map<string, Set<string>>();
      try {
        const scoutingQuery = query(collection(db, "scouting"), where("eventKey", "==", eventKey));
        const scoutingSnap = await getDocs(scoutingQuery);
        scoutingSnap.docs.forEach((docSnap) => {
          const row = docSnap.data() as Record<string, unknown>;
          const matchId = String(row.matchId || "").trim().toLowerCase();
          const teamNumber = String(row.teamNumber || "").trim();
          if (!matchId) return;
          counts[matchId] = (counts[matchId] || 0) + 1;
          if (!teamsByMatch.has(matchId)) teamsByMatch.set(matchId, new Set<string>());
          if (teamNumber) teamsByMatch.get(matchId)?.add(teamNumber);
        });
      } catch (error) {
        console.error("Unable to load scout completion state:", error);
      }
      setScoutedMatchCounts(counts);
      setScoutedTeamsByMatch(
        Object.fromEntries(Array.from(teamsByMatch.entries()).map(([key, value]) => [key, Array.from(value)]))
      );
    }
    void loadScoutedProgress();
  }, [eventKey]);

  const completedMatchSet = useMemo(() => {
    const completed = new Set<string>();
    Object.keys(scoutedMatchCounts).forEach((key) => {
      if (isMatchCompletedByScouts(key)) completed.add(key);
    });
    if (tbaCompletedMatches.size > 0) {
      tbaCompletedMatches.forEach((key) => completed.add(key));
    }
    return completed;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiTargetByMatchId, scoutedMatchCounts, tbaCompletedMatches]);

  function getSelectedMatchId(match: { id: number; type?: "qualification" | "practice" | "finals"; bracket?: "upper" | "lower" }) {
    if (!match.type || match.id <= 0) return "";
    if (match.type === "practice") return `p${match.id}`;
    if (match.type === "qualification") return `q${match.id}`;
    return match.bracket ? `sf${match.id}` : `f${match.id}`;
  }

  function isMatchCompletedByScouts(matchId: string) {
    const target = apiTargetByMatchId[matchId] || 6;
    return (scoutedMatchCounts[matchId] || 0) >= target;
  }

  function isMatchCompleted(matchId: string) {
    if (tbaCompletedMatches.size > 0 && (matchId.startsWith("q") || matchId.startsWith("f") || matchId.startsWith("sf"))) {
      return tbaCompletedMatches.has(matchId);
    }
    return isMatchCompletedByScouts(matchId);
  }

  function handleMatchSelect(id: number, bracket?: "upper" | "lower") {
    if (id === 14 && !bracket) {
      setSelectedMatch({ id: 0, type: "finals" });
      setFinalsStep("number");
      setModalStep("finals");
      return;
    }
    setSelectedMatch({ id, type: "finals", bracket });
    setModalOpen(false);
    setModalStep("type");
    setFinalsStep("bracket");
  }

  function getFinalsDisplayLabel(matchNum: number) {
    if (matchNum === 1) return "Upper Bracket Match 1";
    if (matchNum === 2) return "Upper Bracket Match 2";
    if (matchNum === 3) return "Upper Bracket Match 3";
    if (matchNum === 4) return "Upper Bracket Match 4";
    if (matchNum === 5) return "Lower Bracket Match 5";
    if (matchNum === 6) return "Lower Bracket Match 6";
    if (matchNum === 7) return "Upper Bracket Match 7";
    if (matchNum === 8) return "Upper Bracket Match 8";
    if (matchNum === 9) return "Lower Bracket Match 9";
    if (matchNum === 10) return "Lower Bracket Match 10";
    if (matchNum === 11) return "Upper Bracket Match 11";
    if (matchNum === 12) return "Lower Bracket Match 12";
    if (matchNum === 13) return "Lower Bracket Match 13";
    return `Finals ${matchNum}`;
  }

  const getMatchDisplay = () => {
    if (!selectedMatch.type || selectedMatch.id <= 0) return "No match is set";
    if (selectedMatch.type === "finals" && selectedMatch.bracket) {
      return getFinalsDisplayLabel(selectedMatch.id);
    }
    if (selectedMatch.type === "finals") {
      return `Finals ${selectedMatch.id}`;
    } else if (selectedMatch.type === "practice") {
      return `Practice Match ${selectedMatch.id}`;
    } else {
      return `Qualification Match ${selectedMatch.id}`;
    }
  };

  const activeTeamField = activeFormFields.find((field) => field.id === "team" || field.id === "teamNumber");
  const presetTeamOptions = Array.isArray(activeTeamField?.options)
    ? activeTeamField.options.filter((option) => option.trim().length > 0)
    : [];
  const allowManualTeamEntry = showEventWarning || activeTeamField?.type === "number" || activeTeamField?.type === "text";
  const selectedMatchId = getSelectedMatchId(selectedMatch);
  const selectedMatchApiTeams = apiTeamsByMatchId[selectedMatchId] || [];
  const selectedMatchScoutedTeams = useMemo(
    () => new Set(selectedMatchId ? scoutedTeamsByMatch[selectedMatchId] || [] : []),
    [selectedMatchId, scoutedTeamsByMatch]
  );

  useEffect(() => {
    if (!formData.teamNumber || !selectedMatchId) return;
    if (selectedMatchScoutedTeams.has(formData.teamNumber)) {
      setFormData((prev) => ({ ...prev, teamNumber: "" }));
    }
  }, [formData.teamNumber, selectedMatchId, selectedMatchScoutedTeams]);

  // Kept for business-logic parity with the source form (computed, not surfaced in this view).
  function calculateSubmissionScore(penaltyPoints = 0) {
    let score = 0;
    if (formData.leftStartingZone) score += 3;
    score += formData.autoCoralL1 * 3;
    score += formData.autoCoralL2 * 4;
    score += formData.autoCoralL3 * 6;
    score += formData.autoCoralL4 * 7;
    score += formData.autoAlgaeProcessorScored * 6;
    score += formData.autoAlgaeNetScored * 4;
    score += formData.teleopCoralL1 * 2;
    score += formData.teleopCoralL2 * 3;
    score += formData.teleopCoralL3 * 4;
    score += formData.teleopCoralL4 * 5;
    score += formData.teleopProcessorScored * 6;
    score += formData.teleopNetRobotScored * 4;
    score += formData.teleopNetHumanScored * 4;
    const stageStatus = formData.stageStatus.toLowerCase();
    if (stageStatus.includes("deep")) score += 12;
    else if (stageStatus.includes("shallow")) score += 6;
    else if (stageStatus.includes("park") || stageStatus.includes("barge")) score += 2;
    return score + penaltyPoints;
  }
  void calculateSubmissionScore;

  const practiceRows =
    apiPracticeMatches.length > 0
      ? apiPracticeMatches
      : Array.from({ length: 20 }, (_, i) => {
          const matchNum = i + 1;
          const baseTime = new Date();
          baseTime.setHours(8, 0, 0, 0);
          return {
            matchNum,
            timeString: new Date(baseTime.getTime() + i * 7 * 60000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
          };
        });

  const qualificationRows =
    apiQualificationMatches.length > 0
      ? apiQualificationMatches
      : Array.from({ length: 80 }, (_, i) => {
          const matchNum = i + 1;
          const baseTime = new Date();
          baseTime.setHours(9, 0, 0, 0);
          return {
            matchNum,
            timeString: new Date(baseTime.getTime() + i * 7 * 60000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
          };
        });

  return (
    <HudCanvas>
      <CommandBar>
        <button
          type="button"
          onClick={() => router.push(getDashboardRoute(userData))}
          className="flex items-center gap-2 rounded-full py-1.5 pl-2 pr-4"
        >
          <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-red-800 via-red-600 to-amber-300 text-xs font-black text-white shadow-lg shadow-red-900/25">
            CS
          </span>
          <span className="font-display text-sm text-slate-900">Command</span>
        </button>
        <select
          className="rounded-full border border-amber-300/50 bg-white/50 px-4 py-2 text-xs font-bold text-slate-800 backdrop-blur-xl"
          value="reefscape"
          onChange={(event) => {
            if (event.target.value === "placeholder") {
              router.push("/scout-form?lead=0");
            }
          }}
        >
          <option value="reefscape">REEFSCAPE Form</option>
          <option value="placeholder">REBUILT Form</option>
        </select>
        <Action
          variant="secondary"
          className="lg:hidden"
          onClick={() => setMobileNotesOpen((prev) => !prev)}
        >
          <PencilLine className="h-4 w-4" />
          Notes
        </Action>
      </CommandBar>

      <HudViewport>
        <PageIntro
          eyebrow="Match Scout · REEFSCAPE"
          title="Match Scout Form"
          subtitle="Live scoring capture for autonomous, teleop, and endgame phases of the current assignment."
          actions={
            <Chip
              label="Assigned Match"
              value={getMatchDisplay()}
              tone={selectedMatch.id > 0 ? "gold" : "crimson"}
            />
          }
        />

        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start">
          {/* MAIN TRACK */}
          <div className="flex flex-col gap-6 lg:col-span-8">
            <Deck priority="high" className="lg:mr-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-red-800/70">Current Assignment</p>
                  <p className="mt-1 font-display text-2xl text-slate-950">{getMatchDisplay()}</p>
                </div>
                <Action
                  variant="secondary"
                  onClick={() => {
                    setModalStep("type");
                    setModalOpen(true);
                  }}
                >
                  Fix Assignment
                </Action>
              </div>
            </Deck>

            <Deck className="lg:ml-4">
              <h2 className="font-display text-2xl text-slate-950">Pre-Match Info</h2>
              <div className="mt-4 space-y-4">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Scout Name</label>
                  <input type="text" value={formData.scoutName} disabled className="w-full" />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Team Number</label>
                  {allowManualTeamEntry ? (
                    <input
                      type="text"
                      value={formData.teamNumber}
                      onChange={(e) => setFormData({ ...formData, teamNumber: e.target.value.replace(/[^\d]/g, "") })}
                      className="w-full"
                      placeholder={showEventWarning ? "No match is set - enter team number" : "Enter team number"}
                    />
                  ) : (
                    <select
                      value={formData.teamNumber}
                      onChange={(e) => setFormData({ ...formData, teamNumber: e.target.value })}
                      className="w-full"
                    >
                      <option value="">Select Team</option>
                      {selectedMatchApiTeams.length > 0
                        ? selectedMatchApiTeams.map((teamOption) => (
                            <option key={teamOption} value={teamOption} disabled={selectedMatchScoutedTeams.has(teamOption)}>
                              {selectedMatchScoutedTeams.has(teamOption) ? `${teamOption} (Scouted)` : teamOption}
                            </option>
                          ))
                        : presetTeamOptions.length > 0
                        ? presetTeamOptions.map((teamOption) => (
                            <option key={teamOption} value={teamOption} disabled={selectedMatchScoutedTeams.has(teamOption)}>
                              {selectedMatchScoutedTeams.has(teamOption) ? `${teamOption} (Scouted)` : teamOption}
                            </option>
                          ))
                        : (
                          <>
                            <option value="1234">1234</option>
                            <option value="5678">5678</option>
                            <option value="9012">9012</option>
                            <option value="3456">3456</option>
                            <option value="7890">7890</option>
                            <option value="1122">1122</option>
                          </>
                        )}
                    </select>
                  )}
                  {selectedMatchId && selectedMatchScoutedTeams.size > 0 && (
                    <p className="mt-1 text-xs text-slate-500">Grayed teams were already scouted for this match.</p>
                  )}
                </div>

                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Starting Position</label>
                  <select
                    value={formData.startingPosition}
                    onChange={(e) => setFormData({ ...formData, startingPosition: e.target.value })}
                    className="w-full"
                  >
                    <option value="">Select Position</option>
                    <option value="not-there">Not There</option>
                    <option value="outpost-trench">Outpost Trench</option>
                    <option value="outpost-side">Outpost Side</option>
                    <option value="outpost-bump">Outpost Bump</option>
                    <option value="middle">Middle</option>
                    <option value="depot-bump">Depot Bump</option>
                    <option value="depot-side">Depot Side</option>
                    <option value="depot-trench">Depot Trench</option>
                  </select>
                </div>
              </div>
            </Deck>

            <Deck className="lg:mr-8">
              <h2 className="font-display text-2xl text-slate-950">Autonomous</h2>

              <label className="mt-4 flex items-center gap-2 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={formData.leftStartingZone}
                  onChange={(e) => setFormData({ ...formData, leftStartingZone: e.target.checked })}
                  className="h-4 w-4"
                />
                Left Starting Zone
              </label>

              <div className="mt-4 border-t border-amber-300/30 pt-3">
                <SectionLabel>Auto Coral</SectionLabel>
                <Counter label="Missed Attempts" value={formData.autoCoralMissed} onChange={(val) => setFormData({ ...formData, autoCoralMissed: val })} />
                <Counter label="Level 1" value={formData.autoCoralL1} onChange={(val) => setFormData({ ...formData, autoCoralL1: val })} />
                <Counter label="Level 2" value={formData.autoCoralL2} onChange={(val) => setFormData({ ...formData, autoCoralL2: val })} />
                <Counter label="Level 3" value={formData.autoCoralL3} onChange={(val) => setFormData({ ...formData, autoCoralL3: val })} />
                <Counter label="Level 4" value={formData.autoCoralL4} onChange={(val) => setFormData({ ...formData, autoCoralL4: val })} />
              </div>

              <div className="mt-3 border-t border-amber-300/30 pt-3">
                <SectionLabel>Auto Algae Processor</SectionLabel>
                <Counter label="Missed Attempts" value={formData.autoAlgaeProcessorMissed} onChange={(val) => setFormData({ ...formData, autoAlgaeProcessorMissed: val })} />
                <Counter label="Scored" value={formData.autoAlgaeProcessorScored} onChange={(val) => setFormData({ ...formData, autoAlgaeProcessorScored: val })} />
              </div>

              <div className="mt-3 border-t border-amber-300/30 pt-3">
                <SectionLabel>Auto Algae Net</SectionLabel>
                <Counter label="Missed Attempts" value={formData.autoAlgaeNetMissed} onChange={(val) => setFormData({ ...formData, autoAlgaeNetMissed: val })} />
                <Counter label="Scored" value={formData.autoAlgaeNetScored} onChange={(val) => setFormData({ ...formData, autoAlgaeNetScored: val })} />
              </div>
            </Deck>

            <Deck priority="high" className="lg:ml-6">
              <h2 className="font-display text-2xl text-slate-950">Teleop</h2>

              <div className="mt-4 border-b border-amber-300/30 pb-3">
                <SectionLabel>Teleop Coral</SectionLabel>
                <Counter label="Missed Attempts" value={formData.teleopCoralMissed} onChange={(val) => setFormData({ ...formData, teleopCoralMissed: val })} />
                <Counter label="Level 1" value={formData.teleopCoralL1} onChange={(val) => setFormData({ ...formData, teleopCoralL1: val })} />
                <Counter label="Level 2" value={formData.teleopCoralL2} onChange={(val) => setFormData({ ...formData, teleopCoralL2: val })} />
                <Counter label="Level 3" value={formData.teleopCoralL3} onChange={(val) => setFormData({ ...formData, teleopCoralL3: val })} />
                <Counter label="Level 4" value={formData.teleopCoralL4} onChange={(val) => setFormData({ ...formData, teleopCoralL4: val })} />
              </div>

              <label className="mt-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={formData.teleopAlgaeRemoved}
                  onChange={(e) => setFormData({ ...formData, teleopAlgaeRemoved: e.target.checked })}
                  className="h-4 w-4"
                />
                Removed Algae from Reef
              </label>

              <div className="mt-3 border-t border-amber-300/30 pt-3">
                <SectionLabel>Teleop Processor</SectionLabel>
                <Counter label="Missed Attempts" value={formData.teleopProcessorMissed} onChange={(val) => setFormData({ ...formData, teleopProcessorMissed: val })} />
                <Counter label="Scored" value={formData.teleopProcessorScored} onChange={(val) => setFormData({ ...formData, teleopProcessorScored: val })} />
              </div>

              <div className="mt-3 border-t border-amber-300/30 pt-3">
                <SectionLabel>Teleop Algae Net &ndash; Robot</SectionLabel>
                <Counter label="Missed Attempts" value={formData.teleopNetRobotMissed} onChange={(val) => setFormData({ ...formData, teleopNetRobotMissed: val })} />
                <Counter label="Scored" value={formData.teleopNetRobotScored} onChange={(val) => setFormData({ ...formData, teleopNetRobotScored: val })} />
              </div>

              <div className="mt-3 border-t border-amber-300/30 pt-3">
                <SectionLabel>Teleop Algae Net &ndash; Human Player</SectionLabel>
                <Counter label="Missed Attempts" value={formData.teleopNetHumanMissed} onChange={(val) => setFormData({ ...formData, teleopNetHumanMissed: val })} />
                <Counter label="Scored" value={formData.teleopNetHumanScored} onChange={(val) => setFormData({ ...formData, teleopNetHumanScored: val })} />
              </div>
            </Deck>

            <Deck className="lg:mr-4">
              <h2 className="font-display text-2xl text-slate-950">Endgame</h2>
              <Counter label="Failed Climb" value={formData.failedClimb} onChange={(val) => setFormData({ ...formData, failedClimb: val })} />
              <div className="mt-3">
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Stage Status</label>
                <select
                  value={formData.stageStatus}
                  onChange={(e) => setFormData({ ...formData, stageStatus: e.target.value })}
                  className="w-full"
                >
                  <option value="">Select Status</option>
                  <option value="not-parked">Not Parked</option>
                  <option value="barge">Parked in Barge Zone</option>
                  <option value="shallow">Shallow Cage</option>
                  <option value="deep">Deep Cage</option>
                </select>
              </div>
            </Deck>

            <Deck className="lg:ml-8">
              <h2 className="font-display text-2xl text-slate-950">General</h2>
              <SectionLabel>Things That Occurred</SectionLabel>
              <div className="space-y-2">
                {[
                  { value: "died", label: "Died During Match" },
                  { value: "never-started", label: "Never Started Match" },
                  { value: "disabled", label: "Disabled by FRC" },
                  { value: "recovered", label: "Recovered from Freeze" },
                  { value: "tipped", label: "Tipped Over" },
                  { value: "yellow-card", label: "Yellow Card" },
                  { value: "red-card", label: "Red Card" },
                ].map((incident) => (
                  <label key={incident.value} className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={formData.incidents.includes(incident.value)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setFormData({ ...formData, incidents: [...formData.incidents, incident.value] });
                        } else {
                          setFormData({ ...formData, incidents: formData.incidents.filter((i) => i !== incident.value) });
                        }
                      }}
                      className="h-4 w-4"
                    />
                    {incident.label}
                  </label>
                ))}
              </div>
            </Deck>

            <Deck priority="critical">
              <Action
                variant="danger"
                disabled
                className="w-full justify-center py-3"
                onClick={() => alert("REEFSCAPE match form submissions are disabled.")}
              >
                Submission Disabled for REEFSCAPE
              </Action>
            </Deck>
          </div>

          {/* SIDE TRACK — NOTES */}
          <div className="hidden lg:col-span-4 lg:flex lg:flex-col lg:gap-6">
            <Deck priority="high" className="sticky top-28 flex h-[calc(100vh-9rem)] flex-col">
              <h2 className="font-display text-2xl text-slate-950">Notes</h2>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                className="mt-3 w-full flex-1 resize-none rounded-2xl p-3"
                placeholder="Optional notes"
              />
            </Deck>
          </div>
        </div>
      </HudViewport>

      {/* MOBILE NOTES DRAWER */}
      {mobileNotesOpen && (
        <div className="fixed inset-0 z-[55] lg:hidden">
          <div className="absolute inset-0 bg-slate-950/30 backdrop-blur-md" onClick={() => setMobileNotesOpen(false)} />
          <div className="glass-surface-raised absolute right-0 top-0 h-full w-full max-w-sm p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-2xl text-slate-950">Notes</h2>
              <Action variant="ghost" onClick={() => setMobileNotesOpen(false)}>
                Close
              </Action>
            </div>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              className="h-[calc(100%-4rem)] w-full resize-none rounded-2xl p-3 text-base"
              placeholder="Write notes here..."
            />
          </div>
        </div>
      )}

      {/* MATCH SELECTION MODAL FLOW */}
      <HudModal open={modalOpen} onClose={() => setModalOpen(false)} step={modalStep}>
        {modalStep === "type" && (
          <>
            <h2 className="mb-4 font-display text-2xl text-slate-950">Select Match Type</h2>
            <div className="space-y-3">
              <Action className="w-full justify-center" onClick={() => setModalStep("practice")}>
                Practice
              </Action>
              <Action className="w-full justify-center" onClick={() => setModalStep("qualification")}>
                Qualification
              </Action>
              <Action className="w-full justify-center" onClick={() => setModalStep("finals")}>
                Finals
              </Action>
            </div>
          </>
        )}

        {modalStep === "practice" && (
          <>
            <h2 className="mb-4 font-display text-2xl text-slate-950">Practice Matches</h2>
            <MatchGrid
              rows={practiceRows}
              isMatchCompleted={isMatchCompleted}
              labelPrefix="Practice"
              onPick={(matchNum) => {
                setSelectedMatch({ id: matchNum, type: "practice" });
                setModalOpen(false);
              }}
            />
          </>
        )}

        {modalStep === "qualification" && (
          <>
            <h2 className="mb-4 font-display text-2xl text-slate-950">Qualification Matches</h2>
            <MatchGrid
              rows={qualificationRows}
              isMatchCompleted={isMatchCompleted}
              labelPrefix="Qualification"
              onPick={(matchNum) => {
                setSelectedMatch({ id: matchNum, type: "qualification" });
                setModalOpen(false);
              }}
            />
            <Action className="mt-4 w-full justify-center" onClick={() => setModalOpen(false)}>
              Close
            </Action>
          </>
        )}

        {modalStep === "finals" && finalsStep === "bracket" && (
          <FinalsBracket setSelectedMatch={handleMatchSelect} completedMatches={completedMatchSet} />
        )}

        {modalStep === "finals" && finalsStep === "number" && (
          <>
            <div className="mb-6 flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  setFinalsStep("bracket");
                  setSelectedMatch({ id: 0, type: "qualification" });
                }}
                className="text-sm font-semibold text-slate-600 hover:text-slate-900"
              >
                &larr; Back to Bracket
              </button>
              <h2 className="font-display text-xl text-slate-950">Select Finals Match Number</h2>
              <div className="w-32" />
            </div>

            <p className="mb-6 text-center text-sm text-slate-600">Which finals match are you scouting?</p>

            <div className="mx-auto grid max-w-2xl grid-cols-3 gap-6">
              {[1, 2, 3].map((matchNum) => {
                const done = isMatchCompleted(`f${matchNum}`);
                return (
                  <button
                    key={matchNum}
                    type="button"
                    onClick={() => {
                      setSelectedMatch((prev) => ({ ...prev, type: "finals", id: matchNum, bracket: undefined }));
                      setModalOpen(false);
                      setModalStep("type");
                      setFinalsStep("bracket");
                    }}
                    disabled={done}
                    className={`group relative rounded-2xl border p-8 backdrop-blur-xl transition-all ${
                      done ? "cursor-not-allowed border-slate-300/60 bg-white/25 opacity-40" : "border-amber-300/50 bg-white/50 hover:border-red-500/70 hover:bg-white/70"
                    }`}
                  >
                    <div className="text-center">
                      <div className="mb-3 font-display text-5xl text-red-800 transition-transform group-hover:scale-110">F{matchNum}</div>
                      <div className="text-sm font-semibold text-slate-700">Finals {matchNum}</div>
                      <div className="mt-2 text-xs text-slate-500">
                        {matchNum === 1 && "First Finals"}
                        {matchNum === 2 && "Second Finals"}
                        {matchNum === 3 && "Third Finals (if needed)"}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            <p className="mt-6 text-center text-sm text-slate-500">Select the specific finals match you&apos;re scouting.</p>
          </>
        )}
      </HudModal>
    </HudCanvas>
  );
}

export default function Page() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["coach", "scout"]}>
      <ScoutFormContent />
    </ProtectedRoute>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, addDoc, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";
import { PracticeMatch, PracticeSession, calculateScoutedScore, calculateAccuracy } from "@/app/utils/practiceTypes";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { getEventsForGame, type AnalyticsGame } from "@/app/utils/analyticsEvents";

// Counter component
const Counter = ({ label, value, onChange }: { label: string; value: number; onChange: (val: number) => void }) => (
  <div className="flex items-center justify-between py-2">
    <span className="text-sm font-medium text-gray-700">{label}</span>
    <div className="flex items-center gap-2">
      <button onClick={() => onChange(Math.max(0, value - 1))} className="w-8 h-8 rounded bg-gray-200 hover:bg-gray-300 font-semibold">−</button>
      <span className="w-8 text-center font-semibold">{value}</span>
      <button onClick={() => onChange(value + 1)} className="w-8 h-8 rounded bg-gray-200 hover:bg-gray-300 font-semibold">+</button>
    </div>
  </div>
);

type PracticeMode = 'trial' | 'competitive';
type ScoutedData = PracticeSession["scoutedData"];
type PracticeStep = 'select' | 'practice' | 'break' | 'results';

type PracticeSessionDraft = {
  version: 1;
  savedAt: number;
  scoutId: string;
  selectedDifficulty: 'easy' | 'medium' | 'hard' | null;
  selectedMode: PracticeMode | null;
  currentStep: Extract<PracticeStep, "practice" | "break">;
  currentMatch: PracticeMatch;
  currentRobotIndex: number;
  breakCompletedRobotIndex: number | null;
  robotSessions: ScoutedData[];
  humanPlayerRobot: number | null;
  formData: ScoutedData;
};

const PRACTICE_DRAFT_KEY_PREFIX = "practice-session-draft";

function getPracticeDraftKey(scoutId: string) {
  return `${PRACTICE_DRAFT_KEY_PREFIX}:${scoutId}`;
}

function createEmptyScoutedData(teamNumber = "", notes = ""): ScoutedData {
  return {
    teamNumber,
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
    notes,
  };
}

function sanitizeAllianceTeams(candidate: unknown): number[] {
  const parseValues = (values: unknown[]): number[] =>
    values
      .map((value) => {
        if (typeof value === "number") return value;
        if (typeof value === "string") return parseInt(value.replace(/[^\d]/g, ""), 10);
        return NaN;
      })
      .filter((value) => !Number.isNaN(value) && value > 0);

  if (Array.isArray(candidate)) return parseValues(candidate);
  if (typeof candidate === "string") {
    const trimmed = candidate.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parseValues(parsed);
      } catch {
        return parseValues(trimmed.split(","));
      }
    }
    return parseValues(trimmed.split(","));
  }
  return [];
}

function getMatchTeams(match: PracticeMatch & Record<string, unknown>): number[] {
  const rawAlliances = match["alliances"];
  let alliances: Record<string, unknown> | undefined;
  if (rawAlliances && typeof rawAlliances === "object") {
    alliances = rawAlliances as Record<string, unknown>;
  } else if (typeof rawAlliances === "string") {
    try {
      const parsed = JSON.parse(rawAlliances) as Record<string, unknown>;
      alliances = parsed;
    } catch {
      alliances = undefined;
    }
  }
  const allianceSide = typeof match["alliance"] === "string" ? String(match["alliance"]).toLowerCase() : "";
  const preferredAlliance =
    allianceSide === "blue"
      ? alliances?.["blue"] as Record<string, unknown> | undefined
      : alliances?.["red"] as Record<string, unknown> | undefined;
  const alternateAlliance =
    allianceSide === "blue"
      ? alliances?.["red"] as Record<string, unknown> | undefined
      : alliances?.["blue"] as Record<string, unknown> | undefined;

  const candidates = [
    match.allianceTeams,
    match["teams"],
    match["teamNumbers"],
    match["redAllianceTeams"],
    match["blueAllianceTeams"],
    preferredAlliance?.["team_keys"],
    preferredAlliance?.["teams"],
    alternateAlliance?.["team_keys"],
    alternateAlliance?.["teams"],
  ];

  for (const candidate of candidates) {
    const parsed = sanitizeAllianceTeams(candidate);
    if (parsed.length >= 3) return parsed.slice(0, 3);
  }

  return [];
}

function buildLegacyGroupedMatches(matches: PracticeMatch[]): PracticeMatch[] {
  const grouped = new Map<string, PracticeMatch[]>();
  for (const match of matches) {
    const matchKey = String((match as unknown as Record<string, unknown>).matchKey || "");
    const alliance = String((match as unknown as Record<string, unknown>).alliance || "");
    const key = `${matchKey}::${alliance}`;
    const bucket = grouped.get(key) || [];
    bucket.push(match);
    grouped.set(key, bucket);
  }

  const output: PracticeMatch[] = [];
  for (const entries of grouped.values()) {
    const teams = entries
      .map((entry) => {
        const raw = (entry as unknown as Record<string, unknown>).teamNumber;
        const teamNumber = sanitizeAllianceTeams([raw])[0] || 0;
        const teamPositionRaw = (entry as unknown as Record<string, unknown>).teamPosition;
        const teamPosition =
          typeof teamPositionRaw === "number"
            ? teamPositionRaw
            : typeof teamPositionRaw === "string"
            ? Number(teamPositionRaw)
            : 0;
        return { teamNumber, teamPosition };
      })
      .filter((row) => row.teamNumber > 0)
      .sort((a, b) => a.teamPosition - b.teamPosition)
      .map((row) => row.teamNumber);

    if (teams.length < 3) continue;
    output.push({
      ...entries[0],
      allianceTeams: teams.slice(0, 3),
    });
  }
  return output;
}

function readOfficialData(value: unknown): { score: number; penaltyPoints: number; breakdown: Record<string, unknown> } {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return {
      score: typeof record.score === "number" ? record.score : 0,
      penaltyPoints: typeof record.penaltyPoints === "number" ? record.penaltyPoints : 0,
      breakdown: typeof record.breakdown === "object" && record.breakdown ? (record.breakdown as Record<string, unknown>) : {},
    };
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      return {
        score: typeof parsed.score === "number" ? parsed.score : 0,
        penaltyPoints: typeof parsed.penaltyPoints === "number" ? parsed.penaltyPoints : 0,
        breakdown: typeof parsed.breakdown === "object" && parsed.breakdown ? (parsed.breakdown as Record<string, unknown>) : {},
      };
    } catch {
      return { score: 0, penaltyPoints: 0, breakdown: {} };
    }
  }
  return { score: 0, penaltyPoints: 0, breakdown: {} };
}

function getScoutDevice() {
  if (typeof window === "undefined") {
    return { deviceType: "pc" as const, details: { ua: "", platform: "", viewport: "" } };
  }
  const ua = navigator.userAgent || "";
  const platform = navigator.platform || "";
  const viewport = `${window.innerWidth}x${window.innerHeight}`;
  const coarsePointer = window.matchMedia?.("(pointer: coarse)")?.matches || false;
  const mobileByUa = /Android|iPhone|iPad|iPod|Mobile|Opera Mini|IEMobile/i.test(ua);
  const deviceType = coarsePointer || mobileByUa ? "mobile" as const : "pc" as const;
  return { deviceType, details: { ua, platform, viewport } };
}

function getPracticeEventKey(match: PracticeMatch): string {
  const explicitKey = String((match as unknown as Record<string, unknown>).eventKey || "").trim();
  if (explicitKey) return explicitKey;

  const matchKey = String((match as unknown as Record<string, unknown>).matchKey || "").trim().toLowerCase();
  const parsed = matchKey.match(/^(\d{4}[a-z0-9]+)_/);
  if (parsed?.[1]) return parsed[1];

  return "app-testing";
}

function normalizeEventValue(value: string): string {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function resolvePracticeEvent(match: PracticeMatch, game: AnalyticsGame): { eventKey: string; eventName: string } {
  const catalog = getEventsForGame(game).filter((event) => event.id !== "app-testing");
  const byKey = new Map(catalog.map((event) => [event.id.toLowerCase(), event]));
  const byName = new Map(catalog.map((event) => [normalizeEventValue(event.name), event]));

  const keyCandidate = getPracticeEventKey(match).toLowerCase();
  const keyMatch = byKey.get(keyCandidate);
  if (keyMatch) {
    return { eventKey: keyMatch.id, eventName: keyMatch.name };
  }

  const nameCandidate = String((match as unknown as Record<string, unknown>).eventName || "").trim();
  const normalizedName = normalizeEventValue(nameCandidate);
  const nameMatch = byName.get(normalizedName);
  if (nameMatch) {
    return { eventKey: nameMatch.id, eventName: nameMatch.name };
  }

  if (keyCandidate && keyCandidate !== "app-testing") {
    return { eventKey: keyCandidate, eventName: nameCandidate || keyCandidate };
  }

  if (nameCandidate) {
    return { eventKey: "app-testing", eventName: nameCandidate };
  }

  return { eventKey: "app-testing", eventName: "App Testing" };
}

function PracticeScoutingContent() {
  const router = useRouter();
  const { userData } = useAuth();
  const [activeMatchGame, setActiveMatchGame] = useState<"REEFSCAPE" | "REBUILT">("REEFSCAPE");
  const [currentStep, setCurrentStep] = useState<PracticeStep>('select');
  const [selectedDifficulty, setSelectedDifficulty] = useState<'easy' | 'medium' | 'hard' | null>(null);
  const [selectedMode, setSelectedMode] = useState<PracticeMode | null>(null);
  const [currentMatch, setCurrentMatch] = useState<PracticeMatch | null>(null);
  const [currentRobotIndex, setCurrentRobotIndex] = useState(0);
  const [breakCompletedRobotIndex, setBreakCompletedRobotIndex] = useState<number | null>(null);
  const [robotSessions, setRobotSessions] = useState<ScoutedData[]>([]);
  const [humanPlayerRobot, setHumanPlayerRobot] = useState<number | null>(null); // 0, 1, 2, or null
  const [sessionResults, setSessionResults] = useState<PracticeSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [mobileNotesOpen, setMobileNotesOpen] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<PracticeSessionDraft | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const formPaneRef = useRef<HTMLDivElement | null>(null);

  const [formData, setFormData] = useState<ScoutedData>(createEmptyScoutedData());

  function getYouTubeEmbedUrl(url: string): string {
    if (!url) return "";
    
    let videoId = "";
    
    if (url.includes("youtube.com/watch?v=")) {
      videoId = url.split("v=")[1]?.split("&")[0] || "";
    } else if (url.includes("youtu.be/")) {
      videoId = url.split("youtu.be/")[1]?.split("?")[0] || "";
    } else if (url.includes("youtube.com/embed/")) {
      videoId = url.split("embed/")[1]?.split("?")[0] || "";
    }
    
    if (!videoId) return url;
    
    const controls = selectedMode === 'trial' ? 1 : 0;
    const muted = selectedMode === "competitive" ? 1 : 0;
    
    return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&mute=${muted}&controls=${controls}&disablekb=${controls === 0 ? 1 : 0}&modestbranding=1&rel=0&fs=0&enablejsapi=1&playsinline=1`;
  }

  useEffect(() => {
    if (selectedMode !== "competitive") return;

    const interval = setInterval(() => {
      iframeRef.current?.contentWindow?.postMessage(
        JSON.stringify({ event: "command", func: "playVideo", args: [] }),
        "*"
      );
    }, 900);

    return () => {
      clearInterval(interval);
    };
  }, [selectedMode, currentMatch?.id]);

  useEffect(() => {
    async function loadActiveMatchGame() {
      if (!userData?.teamId) return;
      const teamDoc = await getDoc(doc(db, "teams", userData.teamId));
      if (!teamDoc.exists()) return;
      const value = teamDoc.data().activeMatchGame;
      setActiveMatchGame(value === "REBUILT" ? "REBUILT" : "REEFSCAPE");
    }
    void loadActiveMatchGame();
  }, [userData?.teamId]);

  function clearPracticeDraft() {
    if (typeof window === "undefined" || !userData?.uid) return;
    localStorage.removeItem(getPracticeDraftKey(userData.uid));
  }

  function savePracticeDraft(overrides: Partial<PracticeSessionDraft> = {}) {
    if (typeof window === "undefined" || !userData?.uid || !currentMatch) return;

    const nextStep = (overrides.currentStep || currentStep) as PracticeStep;
    if (nextStep !== "practice" && nextStep !== "break") return;

    const draft: PracticeSessionDraft = {
      version: 1,
      savedAt: Date.now(),
      scoutId: userData.uid,
      selectedDifficulty: overrides.selectedDifficulty ?? selectedDifficulty,
      selectedMode: overrides.selectedMode ?? selectedMode,
      currentStep: nextStep,
      currentMatch: (overrides.currentMatch ?? currentMatch) as PracticeMatch,
      currentRobotIndex: overrides.currentRobotIndex ?? currentRobotIndex,
      breakCompletedRobotIndex: overrides.breakCompletedRobotIndex ?? breakCompletedRobotIndex,
      robotSessions: overrides.robotSessions ?? robotSessions,
      humanPlayerRobot: overrides.humanPlayerRobot ?? humanPlayerRobot,
      formData: overrides.formData ?? formData,
    };
    localStorage.setItem(getPracticeDraftKey(userData.uid), JSON.stringify(draft));
  }

  function restorePracticeDraft(draft: PracticeSessionDraft) {
    const safeStep: PracticeStep = draft.currentStep === "break" ? "break" : "practice";
    setSelectedDifficulty(draft.selectedDifficulty || null);
    setSelectedMode(draft.selectedMode || null);
    setCurrentMatch(draft.currentMatch);
    setCurrentRobotIndex(Math.max(0, Math.min(2, Number(draft.currentRobotIndex) || 0)));
    setBreakCompletedRobotIndex(
      typeof draft.breakCompletedRobotIndex === "number" ? Math.max(0, Math.min(2, draft.breakCompletedRobotIndex)) : null
    );
    setRobotSessions(Array.isArray(draft.robotSessions) ? draft.robotSessions.slice(0, 3) : []);
    setHumanPlayerRobot(
      typeof draft.humanPlayerRobot === "number" ? Math.max(0, Math.min(2, draft.humanPlayerRobot)) : null
    );
    setFormData(draft.formData || createEmptyScoutedData());
    setCurrentStep(safeStep);
    setPendingDraft(null);
  }

  useEffect(() => {
    if (typeof window === "undefined" || !userData?.uid) return;
    const raw = localStorage.getItem(getPracticeDraftKey(userData.uid));
    if (!raw) {
      setPendingDraft(null);
      return;
    }

    try {
      const parsed = JSON.parse(raw) as Partial<PracticeSessionDraft>;
      if (
        parsed &&
        parsed.version === 1 &&
        parsed.currentMatch &&
        (parsed.currentStep === "practice" || parsed.currentStep === "break")
      ) {
        setPendingDraft(parsed as PracticeSessionDraft);
      } else {
        localStorage.removeItem(getPracticeDraftKey(userData.uid));
        setPendingDraft(null);
      }
    } catch {
      localStorage.removeItem(getPracticeDraftKey(userData.uid));
      setPendingDraft(null);
    }
  }, [userData?.uid]);

  async function selectPracticeMatch(difficulty: 'easy' | 'medium' | 'hard', mode: PracticeMode) {
    clearPracticeDraft();
    setPendingDraft(null);
    setLoading(true);
    setSelectedDifficulty(difficulty);
    setSelectedMode(mode);

    try {
      let matches: PracticeMatch[] = [];
      try {
        const matchesQuery = query(
          collection(db, 'practiceMatches'),
          where('difficulty', '==', difficulty)
        );
        const matchesSnapshot = await getDocs(matchesQuery);
        matches = matchesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as PracticeMatch[];
      } catch (queryError) {
        const allSnapshot = await getDocs(collection(db, "practiceMatches"));
        const allMatches = allSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as PracticeMatch[];
        matches = allMatches.filter((match) => match.difficulty === difficulty);
        console.warn("Difficulty query failed; using fallback practice match load.", queryError);
      }

      if (matches.length === 0) {
        alert('No practice matches available for this difficulty.');
        setLoading(false);
        return;
      }

      const normalizedMatches = matches
        .map((match) => {
          const parsedTeams = getMatchTeams(match as unknown as PracticeMatch & Record<string, unknown>);
          return { ...match, allianceTeams: parsedTeams };
        })
        .filter((match) => match.allianceTeams.length >= 3);

      let candidateMatches = normalizedMatches;
      if (candidateMatches.length === 0) {
        candidateMatches = buildLegacyGroupedMatches(matches);
      }
      if (candidateMatches.length === 0) {
        const allSnapshot = await getDocs(collection(db, "practiceMatches"));
        const allMatches = allSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as PracticeMatch[];
        candidateMatches = buildLegacyGroupedMatches(allMatches);
      }
      if (candidateMatches.length === 0) {
        alert("No practice matches have valid alliance team data. Please add team numbers to practice match docs.");
        return;
      }

      const randomMatch = candidateMatches[Math.floor(Math.random() * candidateMatches.length)];
      const fallbackTeams = randomMatch.allianceTeams.slice(0, 3);
      const official = readOfficialData(randomMatch.officialData);
      const safeOfficialScore =
        typeof official.score === "number" && official.score > 0
          ? official.score
          : typeof (randomMatch as unknown as Record<string, unknown>).officialScore === "number"
          ? Number((randomMatch as unknown as Record<string, unknown>).officialScore)
          : typeof randomMatch.actualScore === "number"
          ? randomMatch.actualScore
          : 0;

      const safeMatch: PracticeMatch = {
        ...randomMatch,
        allianceTeams: fallbackTeams,
        officialData: {
          score: safeOfficialScore,
          penaltyPoints: Number(official.penaltyPoints || 0),
          breakdown: official.breakdown || {},
        },
      };

      setCurrentMatch(safeMatch);
      setCurrentRobotIndex(0);
      setBreakCompletedRobotIndex(null);
      setRobotSessions([]);

      setFormData(createEmptyScoutedData(safeMatch.allianceTeams[0].toString()));

      setHumanPlayerRobot(Math.floor(Math.random() * 3));

      setCurrentStep('practice');
    } catch (error) {
      console.error('Error loading practice match:', error);
      const details = (error as { code?: string; message?: string })?.message || "";
      if (details.toLowerCase().includes("permission")) {
        alert("Error loading practice match. Check Firestore rules for read access to practiceMatches.");
      } else {
        alert('Error loading practice match.');
      }
    } finally {
      setLoading(false);
    }
  }

  async function submitCurrentRobot() {
    if (!currentMatch || !userData) return;

    const robotData = { ...formData };
    const nextRobotSessions = [...robotSessions, robotData];
    setRobotSessions(nextRobotSessions);

    if (currentRobotIndex === 2) {
      await submitPracticeSession(nextRobotSessions);
      return;
    }

    setBreakCompletedRobotIndex(currentRobotIndex);
    setCurrentStep('break');
    savePracticeDraft({
      currentStep: "break",
      breakCompletedRobotIndex: currentRobotIndex,
      robotSessions: nextRobotSessions,
    });
  }

  function continueToNextRobot() {
    if (!currentMatch) return;
    const nextRobotIndex = currentRobotIndex + 1;
    if (nextRobotIndex > 2) return;

    setCurrentRobotIndex(nextRobotIndex);
    setFormData(createEmptyScoutedData(currentMatch.allianceTeams[nextRobotIndex].toString()));
    setCurrentStep('practice');
    setMobileNotesOpen(false);
    formPaneRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submitPracticeSession(allRobotData: ScoutedData[]) {
    if (!currentMatch || !userData) return;
    if (allRobotData.length === 0) return;

    setLoading(true);
    try {
      const scores = allRobotData.map(data => calculateScoutedScore(data));
      const baseScoutedScore = scores.reduce((a, b) => a + b, 0);
      const penaltyPoints = Number(currentMatch.officialData?.penaltyPoints || 0);
      const totalScoutedScore = baseScoutedScore + penaltyPoints;
      const officialAllianceScore =
        typeof currentMatch.officialData?.score === "number"
          ? currentMatch.officialData.score
          : typeof currentMatch.actualScore === "number"
          ? currentMatch.actualScore
          : 0;
      const sessionAccuracy = calculateAccuracy(totalScoutedScore, officialAllianceScore);

      const now = Date.now();
      const device = getScoutDevice();
      const { eventKey, eventName } = resolvePracticeEvent(currentMatch, activeMatchGame);

      const session: Partial<PracticeSession> & Record<string, unknown> = {
        scoutName: userData.displayName,
        scoutId: userData.uid,
        matchId: currentMatch.id || '',
        matchKey: currentMatch.matchKey || "",
        matchNumber: currentMatch.matchNumber,
        matchType: currentMatch.matchType || 'practice',
        difficulty: selectedDifficulty || 'easy',
        mode: selectedMode || 'trial',
        scoutedData: allRobotData[0],
        allScoutedData: allRobotData,
        eventKey,
        eventName,
        game: activeMatchGame,
        officialScore: officialAllianceScore,
        actualScore: officialAllianceScore,
        scoutedScore: totalScoutedScore,
        penaltyPoints,
        accuracy: sessionAccuracy,
        deviceType: device.deviceType,
        deviceDetails: device.details,
        timestamp: now,
        startedAt: now,
        completedAt: now,
      };

      const docRef = await addDoc(collection(db, 'practiceSessions'), session);

      await Promise.all(
        allRobotData.map((robotData) =>
          addDoc(collection(db, "scouting"), {
            ...robotData,
            scoutName: userData.displayName,
            scoutId: userData.uid,
            matchId: `q${currentMatch.matchNumber}`,
            matchNumber: String(currentMatch.matchNumber),
            matchType: "qualification",
            eventKey,
            eventName,
            game: activeMatchGame,
            accuracy: sessionAccuracy,
            timestamp: now,
            submittedAt: now,
            practiceMode: selectedMode || "trial",
            difficulty: selectedDifficulty || "easy",
            isPracticeScouting: true,
            practiceSessionId: docRef.id,
            penaltyPoints,
            deviceType: device.deviceType,
            deviceDetails: device.details,
          })
        )
      );

      setSessionResults({ ...(session as PracticeSession), id: docRef.id });
      setCurrentStep('results');
      clearPracticeDraft();
      setPendingDraft(null);
    } catch (error) {
      console.error('Error submitting practice session:', error);
      alert('Error submitting practice session: ' + (error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function resetPractice() {
    setCurrentStep('select');
    setSelectedDifficulty(null);
    setSelectedMode(null);
    setCurrentMatch(null);
    setCurrentRobotIndex(0);
    setBreakCompletedRobotIndex(null);
    setRobotSessions([]);
    setHumanPlayerRobot(null);
    setSessionResults(null);
    setMobileNotesOpen(false);
    setFormData(createEmptyScoutedData());
    clearPracticeDraft();
    setPendingDraft(null);
  }

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        {/* STEP 1: MODE & DIFFICULTY SELECTION */}
        {currentStep === 'select' && (
          <div className="p-4 md:p-8 max-w-4xl mx-auto">
            <h1 className="text-2xl md:text-3xl font-bold mb-2" style={{ color: "#c42221" }}>
              Practice Scouting
            </h1>
            <p className="text-gray-600 mb-8">Improve your accuracy by practicing with real match footage.</p>
            {pendingDraft && (
              <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4">
                <h2 className="font-semibold text-amber-900 mb-1">Resume Saved Session?</h2>
                <p className="text-sm text-amber-800 mb-3">
                  You have an unfinished practice session with {pendingDraft.robotSessions.length} completed robot
                  {pendingDraft.robotSessions.length === 1 ? "" : "s"}.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => restorePracticeDraft(pendingDraft)}
                    className="px-4 py-2 rounded text-white font-semibold"
                    style={{ backgroundColor: "#c42221" }}
                  >
                    Resume Session
                  </button>
                  <button
                    onClick={() => {
                      clearPracticeDraft();
                      setPendingDraft(null);
                    }}
                    className="px-4 py-2 rounded border border-gray-300 font-semibold hover:bg-gray-50"
                  >
                    Discard Saved Session
                  </button>
                </div>
              </div>
            )}

            {!selectedMode ? (
              <>
                <h2 className="text-xl font-semibold mb-4">Select Mode</h2>
                <div className="grid md:grid-cols-2 gap-4 mb-8">
                  <button
                    onClick={() => setSelectedMode('trial')}
                    className="p-6 border-2 border-blue-300 rounded-lg hover:bg-blue-50 text-left transition-colors"
                  >
                    <div className="text-sm font-semibold mb-2 text-blue-700">TRIAL</div>
                    <h3 className="font-semibold text-lg mb-1">Trial Mode</h3>
                    <p className="text-sm text-gray-600 mb-2">For Learning</p>
                    <ul className="text-xs text-gray-500 space-y-1">
                      <li>• Video can be paused</li>
                      <li>• Practice at your own pace</li>
                      <li>• Separate leaderboard</li>
                    </ul>
                  </button>

                  <button
                    onClick={() => setSelectedMode('competitive')}
                    className="p-6 border-2 border-red-300 rounded-lg hover:bg-red-50 text-left transition-colors"
                  >
                    <div className="text-sm font-semibold mb-2 text-red-700">COMP</div>
                    <h3 className="font-semibold text-lg mb-1">Competitive Mode</h3>
                    <p className="text-sm text-gray-600 mb-2">Test Your Skills</p>
                    <ul className="text-xs text-gray-500 space-y-1">
                      <li>• Video cannot be paused</li>
                      <li>• Real match conditions</li>
                      <li>• Separate leaderboard</li>
                    </ul>
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-semibold">Select Difficulty</h2>
                  <button
                    onClick={() => setSelectedMode(null)}
                    className="text-sm text-gray-600 hover:text-gray-800"
                  >
                    ← Change Mode
                  </button>
                </div>
                <div className="grid md:grid-cols-3 gap-4">
                  <button
                    onClick={() => selectPracticeMatch('easy', selectedMode)}
                    disabled={loading}
                    className="p-6 border-2 border-green-300 rounded-lg hover:bg-green-50 text-left transition-colors disabled:opacity-50"
                  >
                    <div className="text-sm font-semibold mb-2 text-green-700">EASY</div>
                    <h3 className="font-semibold text-lg mb-1">Easy</h3>
                    <p className="text-sm text-gray-600">Low-scoring matches</p>
                  </button>

                  <button
                    onClick={() => selectPracticeMatch('medium', selectedMode)}
                    disabled={loading}
                    className="p-6 border-2 border-yellow-300 rounded-lg hover:bg-yellow-50 text-left transition-colors disabled:opacity-50"
                  >
                    <div className="text-sm font-semibold mb-2 text-yellow-700">MEDIUM</div>
                    <h3 className="font-semibold text-lg mb-1">Medium</h3>
                    <p className="text-sm text-gray-600">Average matches</p>
                  </button>

                  <button
                    onClick={() => selectPracticeMatch('hard', selectedMode)}
                    disabled={loading}
                    className="p-6 border-2 border-red-300 rounded-lg hover:bg-red-50 text-left transition-colors disabled:opacity-50"
                  >
                    <div className="text-sm font-semibold mb-2 text-red-700">HARD</div>
                    <h3 className="font-semibold text-lg mb-1">Hard</h3>
                    <p className="text-sm text-gray-600">High-scoring matches</p>
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {currentStep === 'break' && currentMatch && breakCompletedRobotIndex !== null && (
          <div className="p-4 md:p-8 max-w-3xl mx-auto min-h-[calc(100vh-4rem)] flex items-center">
            <div className="w-full bg-white rounded-2xl shadow-md border border-gray-200 p-8">
              <h1 className="text-2xl md:text-3xl font-bold mb-2" style={{ color: "#c42221" }}>
                Robot {breakCompletedRobotIndex + 1} Complete
              </h1>
              <p className="text-gray-700 text-lg mb-3">
                Team {currentMatch.allianceTeams[breakCompletedRobotIndex]} scouting is complete.
              </p>
              <p className="text-gray-600 mb-8">
                Take a short break before the next robot, just like normal scouting rotations between matches.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={continueToNextRobot}
                  className="flex-1 py-3 rounded-lg text-white font-semibold"
                  style={{ backgroundColor: "#c42221" }}
                >
                  Continue To Robot {currentRobotIndex + 2} (Team {currentMatch.allianceTeams[currentRobotIndex + 1]})
                </button>
                <button
                  onClick={resetPractice}
                  className="flex-1 py-3 rounded-lg border-2 border-gray-300 font-semibold hover:bg-gray-50"
                >
                  End Session
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STEP 2: PRACTICE SCOUTING */}
        {currentStep === 'practice' && currentMatch && (
          <div className="h-screen flex flex-col md:flex-row">
            {/* VIDEO PLAYER */}
            <div className="shrink-0 bg-black md:flex md:flex-col md:flex-1">
              <div className="relative w-full aspect-video md:aspect-auto md:flex-1">
                <iframe
                  key={`${currentMatch.id}-${currentRobotIndex}`}
                  ref={iframeRef}
                  src={getYouTubeEmbedUrl(currentMatch.videoUrl)}
                  className="w-full h-full"
                  allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
                  title="Practice Match Video"
                  frameBorder="0"
                />
                {selectedMode === "competitive" && (
                  <div className="absolute inset-0 z-10" aria-hidden="true" />
                )}
              </div>

              {/* Match Info */}
              <div className="hidden md:block bg-black bg-opacity-90 text-white p-4">
                <h3 className="font-semibold text-lg">
                  {currentMatch.matchType === 'qualification' ? 'Qualification' : 
                   currentMatch.matchType === 'playoff' ? 'Playoff' : 'Practice'} Match {currentMatch.matchNumber}
                </h3>
                <p className="text-sm">Robot {currentRobotIndex + 1} of 3 • Team {currentMatch.allianceTeams[currentRobotIndex]}</p>
                <p className="text-sm capitalize">{currentMatch.alliance} Alliance • {selectedMode} Mode</p>
                {selectedMode === 'competitive' && (
                  <p className="text-xs mt-2 text-yellow-300">Video cannot be paused in competitive mode.</p>
                )}
              </div>
            </div>

            {/* SCOUTING FORM */}
            <div ref={formPaneRef} className="w-full md:w-[22rem] md:flex-none flex-1 min-h-0 overflow-y-auto bg-gray-100 p-4 space-y-4">
              {/* Progress indicator */}
              <div className="bg-white rounded-lg p-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm font-semibold">Progress</span>
                  <span className="text-sm text-gray-600">Robot {currentRobotIndex + 1}/3</span>
                </div>
                <div className="flex gap-2">
                  {[0, 1, 2].map(i => (
                    <div
                      key={i}
                      className={`flex-1 h-2 rounded ${
                        i < currentRobotIndex ? 'bg-green-500' :
                        i === currentRobotIndex ? 'bg-blue-500' :
                        'bg-gray-200'
                      }`}
                    />
                  ))}
                </div>
              </div>

              {humanPlayerRobot === currentRobotIndex && (
                <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-4">
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div className="ml-3">
                      <p className="text-sm font-medium text-yellow-800">
                        This match, include the <strong>Human Player</strong> score
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* PRE-MATCH INFO */}
              <div className="bg-white rounded-xl shadow p-4">
                <h2 className="text-lg font-semibold mb-4" style={{ color: "#c42221" }}>Pre-Match Info</h2>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Team Number</label>
                    <input type="text" value={formData.teamNumber} disabled className="w-full border rounded p-2 bg-gray-100 text-gray-600" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Starting Position</label>
                    <select value={formData.startingPosition} onChange={(e) => setFormData({ ...formData, startingPosition: e.target.value })} className="w-full border rounded p-2">
                      <option value="">Select Position</option>
                      <option value="Not There">Not There</option>
                      <option value="Processor Side">Processor Side</option>
                      <option value="Middle">Middle</option>
                      <option value="Opposite Side">Opposite Side</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* AUTONOMOUS */}
              <div className="bg-white rounded-xl shadow p-4">
                <h2 className="text-lg font-semibold mb-4" style={{ color: "#c42221" }}>Autonomous</h2>
                <label className="flex items-center gap-2 cursor-pointer mb-3">
                  <input type="checkbox" checked={formData.leftStartingZone} onChange={(e) => setFormData({ ...formData, leftStartingZone: e.target.checked })} className="w-4 h-4" />
                  <span className="text-sm font-medium text-gray-700">Left Starting Zone</span>
                </label>
                <div className="border-t pt-3">
                  <h3 className="font-semibold text-base mb-2">Auto Coral</h3>
                  <Counter label="Missed" value={formData.autoCoralMissed} onChange={(val) => setFormData({ ...formData, autoCoralMissed: val })} />
                  <Counter label="Level 1" value={formData.autoCoralL1} onChange={(val) => setFormData({ ...formData, autoCoralL1: val })} />
                  <Counter label="Level 2" value={formData.autoCoralL2} onChange={(val) => setFormData({ ...formData, autoCoralL2: val })} />
                  <Counter label="Level 3" value={formData.autoCoralL3} onChange={(val) => setFormData({ ...formData, autoCoralL3: val })} />
                  <Counter label="Level 4" value={formData.autoCoralL4} onChange={(val) => setFormData({ ...formData, autoCoralL4: val })} />
                </div>
                <div className="border-t pt-3 mt-3">
                  <h3 className="font-semibold text-base mb-2">Auto Algae Processor</h3>
                  <Counter label="Missed" value={formData.autoAlgaeProcessorMissed} onChange={(val) => setFormData({ ...formData, autoAlgaeProcessorMissed: val })} />
                  <Counter label="Scored" value={formData.autoAlgaeProcessorScored} onChange={(val) => setFormData({ ...formData, autoAlgaeProcessorScored: val })} />
                </div>
                <div className="border-t pt-3 mt-3">
                  <h3 className="font-semibold text-base mb-2">Auto Algae Net</h3>
                  <Counter label="Missed" value={formData.autoAlgaeNetMissed} onChange={(val) => setFormData({ ...formData, autoAlgaeNetMissed: val })} />
                  <Counter label="Scored" value={formData.autoAlgaeNetScored} onChange={(val) => setFormData({ ...formData, autoAlgaeNetScored: val })} />
                </div>
              </div>

              {/* TELEOP */}
              <div className="bg-white rounded-xl shadow p-4">
                <h2 className="text-lg font-semibold mb-4" style={{ color: "#c42221" }}>Teleop</h2>
                <div className="border-b pb-3">
                  <h3 className="font-semibold text-base mb-2">Teleop Coral</h3>
                  <Counter label="Missed" value={formData.teleopCoralMissed} onChange={(val) => setFormData({ ...formData, teleopCoralMissed: val })} />
                  <Counter label="Level 1" value={formData.teleopCoralL1} onChange={(val) => setFormData({ ...formData, teleopCoralL1: val })} />
                  <Counter label="Level 2" value={formData.teleopCoralL2} onChange={(val) => setFormData({ ...formData, teleopCoralL2: val })} />
                  <Counter label="Level 3" value={formData.teleopCoralL3} onChange={(val) => setFormData({ ...formData, teleopCoralL3: val })} />
                  <Counter label="Level 4" value={formData.teleopCoralL4} onChange={(val) => setFormData({ ...formData, teleopCoralL4: val })} />
                </div>
                <label className="flex items-center gap-2 cursor-pointer my-3">
                  <input type="checkbox" checked={formData.teleopAlgaeRemoved} onChange={(e) => setFormData({ ...formData, teleopAlgaeRemoved: e.target.checked })} className="w-4 h-4" />
                  <span className="text-sm font-medium text-gray-700">Removed Algae from Reef</span>
                </label>
                <div className="border-t pt-3">
                  <h3 className="font-semibold text-base mb-2">Teleop Processor</h3>
                  <Counter label="Missed" value={formData.teleopProcessorMissed} onChange={(val) => setFormData({ ...formData, teleopProcessorMissed: val })} />
                  <Counter label="Scored" value={formData.teleopProcessorScored} onChange={(val) => setFormData({ ...formData, teleopProcessorScored: val })} />
                </div>
                <div className="border-t pt-3 mt-3">
                  <h3 className="font-semibold text-base mb-2">Teleop Algae Net – Robot</h3>
                  <Counter label="Missed" value={formData.teleopNetRobotMissed} onChange={(val) => setFormData({ ...formData, teleopNetRobotMissed: val })} />
                  <Counter label="Scored" value={formData.teleopNetRobotScored} onChange={(val) => setFormData({ ...formData, teleopNetRobotScored: val })} />
                </div>
                <div className="border-t pt-3 mt-3">
                  <h3 className="font-semibold text-base mb-2">Teleop Algae Net – Human</h3>
                  <Counter label="Missed" value={formData.teleopNetHumanMissed} onChange={(val) => setFormData({ ...formData, teleopNetHumanMissed: val })} />
                  <Counter label="Scored" value={formData.teleopNetHumanScored} onChange={(val) => setFormData({ ...formData, teleopNetHumanScored: val })} />
                </div>
              </div>

              {/* ENDGAME */}
              <div className="bg-white rounded-xl shadow p-4">
                <h2 className="text-lg font-semibold mb-4" style={{ color: "#c42221" }}>Endgame</h2>
                <Counter label="Failed Climb" value={formData.failedClimb} onChange={(val) => setFormData({ ...formData, failedClimb: val })} />
                <div className="mt-3">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Stage Status</label>
                  <select value={formData.stageStatus} onChange={(e) => setFormData({ ...formData, stageStatus: e.target.value })} className="w-full border rounded p-2">
                    <option value="">Select Status</option>
                    <option value="None">None</option>
                    <option value="Parked">Parked</option>
                    <option value="Shallow">Shallow</option>
                    <option value="Deep">Deep</option>
                  </select>
                </div>
              </div>

              {/* GENERAL */}
              <div className="bg-white rounded-xl shadow p-4">
                <h2 className="text-lg font-semibold mb-4" style={{ color: "#c42221" }}>General</h2>
                <div className="space-y-2">
                  {['Died During Match', 'Never Started Match', 'Disabled by FRC', 'Recovered from Freeze', 'Tipped Over', 'Yellow Card', 'Red Card'].map((incident) => (
                    <label key={incident} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.incidents.includes(incident)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setFormData({ ...formData, incidents: [...formData.incidents, incident] });
                          } else {
                            setFormData({ ...formData, incidents: formData.incidents.filter(i => i !== incident) });
                          }
                        }}
                        className="w-4 h-4"
                      />
                      <span className="text-sm">{incident}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* SUBMIT BUTTON */}
              <div className="sticky bottom-0 bg-gray-100 pt-4 pb-2 space-y-2">
                <button
                  onClick={submitCurrentRobot}
                  disabled={loading}
                  className="w-full py-3 rounded-lg text-white font-semibold disabled:opacity-50"
                  style={{ backgroundColor: "#c42221" }}
                >
                  {loading ? "Submitting..." : 
                   currentRobotIndex === 2 ? "Finish Session" : 
                   `Next Robot (${currentRobotIndex + 2}/3)`}
                </button>
                <button
                  onClick={resetPractice}
                  className="w-full py-2 rounded-lg border-2 border-gray-300 font-semibold hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </div>

            {/* NOTES TOGGLE BUTTON */}
            <button
              onClick={() => setNotesOpen(!notesOpen)}
              className="hidden md:block fixed right-0 top-1/2 -translate-y-1/2 bg-red-600 text-white px-2 py-8 rounded-l-lg shadow-lg hover:bg-red-700 z-10"
            >
              {notesOpen ? <ChevronRight /> : <ChevronLeft />}
            </button>

            {/* NOTES PANEL */}
            <div className={`bg-white shadow-xl transition-all duration-300 overflow-y-auto ${notesOpen ? 'w-80' : 'w-0'} hidden md:block`}>
              {notesOpen && (
                <div className="p-4">
                  <h2 className="text-lg font-semibold mb-4" style={{ color: "#c42221" }}>Notes</h2>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    className="w-full border rounded p-2 h-96"
                    placeholder="Optional notes..."
                  />
                </div>
              )}
            </div>

            {/* MOBILE STICKY NOTES */}
            <button
              onClick={() => setMobileNotesOpen(true)}
              className="md:hidden fixed right-2 top-1/2 -translate-y-1/2 bg-red-600 text-white px-2 py-5 rounded-l-lg shadow-lg z-30"
              aria-label="Open notes"
            >
              <ChevronLeft />
            </button>
            {mobileNotesOpen && (
              <div className="md:hidden fixed inset-0 z-40">
                <button
                  className="absolute inset-0 bg-black/40"
                  onClick={() => setMobileNotesOpen(false)}
                  aria-label="Close notes overlay"
                />
                <div className="absolute bottom-0 left-0 right-0 h-[38vh] min-h-[220px] max-h-[45vh] bg-white shadow-2xl rounded-t-2xl overflow-y-auto">
                  <div className="sticky top-0 z-10 bg-white border-b p-3 flex items-center justify-between">
                    <h2 className="text-base font-semibold" style={{ color: "#c42221" }}>Notes</h2>
                    <button
                      onClick={() => setMobileNotesOpen(false)}
                      className="p-1 rounded hover:bg-gray-100"
                      aria-label="Close notes"
                    >
                      <X size={18} />
                    </button>
                  </div>
                  <div className="p-3">
                    <textarea
                      value={formData.notes}
                      onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                      className="w-full border rounded p-2 h-[26vh] min-h-[140px]"
                      placeholder="Optional notes..."
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* STEP 3: RESULTS */}
        {currentStep === 'results' && sessionResults && (
          <div className="p-4 md:p-8 max-w-4xl mx-auto">
            <h1 className="text-2xl md:text-3xl font-bold mb-2" style={{ color: "#c42221" }}>
              Practice Complete!
            </h1>
            <p className="text-gray-600 mb-8">You&apos;ve completed all 3 robots. Here&apos;s your score:</p>

            <div className="bg-white rounded-xl shadow-md p-8 mb-6 text-center">
              <div className="inline-block px-4 py-1 bg-blue-100 text-blue-800 rounded-full text-sm mb-4">
                {selectedMode === 'trial' ? 'Trial Mode' : 'Competitive Mode'}
              </div>
              <h2 className="text-xl font-semibold mb-2">Your Accuracy</h2>
              <div className="text-6xl font-bold mb-4" style={{ color: sessionResults.accuracy >= 90 ? "#22c55e" : sessionResults.accuracy >= 75 ? "#eab308" : "#ef4444" }}>
                {sessionResults.accuracy}%
              </div>
              <p className="text-gray-600">Based on total alliance score from all 3 robots</p>
            </div>

            <div className="bg-white rounded-xl shadow-md p-8 mb-6">
              <h2 className="text-xl font-semibold mb-4">Score Comparison</h2>
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <h3 className="font-semibold mb-2">Your Scouted Score</h3>
                  <p className="text-4xl font-bold" style={{ color: "#c42221" }}>{sessionResults.scoutedScore}</p>
                </div>
                <div>
                  <h3 className="font-semibold mb-2">Actual Score</h3>
                  <p className="text-4xl font-bold text-gray-700">{sessionResults.officialScore}</p>
                </div>
              </div>
            </div>

            <div className="flex gap-4">
              <button onClick={resetPractice} className="flex-1 py-3 rounded-lg text-white font-semibold" style={{ backgroundColor: "#c42221" }}>
                Practice Again
              </button>
              <button onClick={() => router.push("/scout-dashboard")} className="flex-1 py-3 rounded-lg border-2 border-gray-300 font-semibold hover:bg-gray-50">
                Dashboard
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function PracticeScouting() {
  return (
    <ProtectedRoute requireAuth={true}>
      <PracticeScoutingContent />
    </ProtectedRoute>
  );
}

"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";
import { isEventActive } from "@/app/utils/eventDates";

/* -------------------------------------------------------
   MODAL — Fade In + Fade Out + Smooth Resize
-------------------------------------------------------- */
function Modal({
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
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className={`
          absolute inset-0 bg-black/40 backdrop-blur-sm
          transition-opacity duration-300
          ${visible ? "opacity-100" : "opacity-0"}
        `}
        onClick={onClose}
      />

      <div
        className={`
          relative bg-white rounded-2xl shadow-xl
          transition-all duration-300
          ${visible ? "opacity-100" : "opacity-0"}
          ${
            step === "qualification"
              ? "w-[85%] max-w-[900px]"
              : step === "finals"
              ? "w-[90%] max-w-[1400px]"
              : "w-[90%] max-w-md"
          }
        `}
      >
        <div
          style={{ height }}
          className={`
            overflow-hidden
            ${hasOpened ? "transition-[height] duration-300 ease-out" : ""}
          `}
        >
          <div ref={contentRef} className="p-6">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------
   MATCH BOX — Used in Finals Bracket
-------------------------------------------------------- */
type MatchStatus = "completed" | "next" | "upcoming";

interface Match {
  id: number;
  label: string;
  status: MatchStatus;
  bracket?: "upper" | "lower";
}

function MatchBox({
  match,
  setSelectedMatch,
  setModalOpen,
}: {
  match: Match;
  setSelectedMatch: (id: number, bracket?: "upper" | "lower") => void;
  setModalOpen: (open: boolean) => void;
}) {
  const borderColors: Record<MatchStatus, string> = {
    completed: "border-green-500",
    next: "border-yellow-500",
    upcoming: "border-red-500",
  };

  const badgeColors: Record<MatchStatus, string> = {
    completed: "bg-green-500",
    next: "bg-yellow-500",
    upcoming: "bg-red-500",
  };

  const badgeText: Record<MatchStatus, string> = {
    completed: "Done",
    next: "Next",
    upcoming: "Up",
  };

  return (
    <button
      onClick={() => {
        setSelectedMatch(match.id, match.bracket);
        setModalOpen(false);
      }}
      className={`
        relative w-[120px] min-h-[62px] text-xs rounded border text-left bg-white
        border-t border-b border-l border-r
        ${borderColors[match.status]}
        hover:bg-gray-50
      `}
    >
      <div
        className={`
          absolute top-0.5 right-0.5 text-[10px] px-1 py-0.5 rounded-full text-white
          ${badgeColors[match.status]}
        `}
      >
        {badgeText[match.status]}
      </div>
      <div className="pt-1.5 pb-1 px-1.5">
        <div className="font-semibold text-[11px] leading-tight">{match.label}</div>
        <div className="mt-1.5 border-t border-gray-200 pt-1">
          {(() => {
            const baseTime = new Date();
            baseTime.setHours(13, 0, 0, 0);
            const matchTime = new Date(baseTime.getTime() + (match.id - 1) * 6 * 60000);
            const timeString = matchTime.toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            });
            
            return (
              <div className="text-[10px] text-gray-600 text-center">
                {timeString}
              </div>
            );
          })()}
        </div>
      </div>
    </button>
  );
}

function FinalsBracket({
  setSelectedMatch,
  setModalOpen,
}: {
  setSelectedMatch: (id: number, bracket?: "upper" | "lower") => void;
  setModalOpen: (open: boolean) => void;
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
    <div className="relative w-full flex justify-center py-6 overflow-x-auto">
      <div style={{ width: totalWidth }}>
        <div className="flex mb-4 gap-[60px] pl-0">
          {[1, 2, 3, 4, 5, 6].map((r) => (
            <div key={r} className="text-xs font-semibold text-gray-600 uppercase tracking-wide text-center" style={{ width: B.w }}>
              Round {r}
            </div>
          ))}
        </div>

        <div className="relative" style={{ width: totalWidth, height }}>
          <svg className="absolute inset-0 pointer-events-none overflow-visible" width={totalWidth} height={height}>
            <g stroke="#9ca3af" strokeWidth="2" fill="none">
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
            <MatchBox match={{ id: 1, label: "Match 1", status: "completed", bracket: "upper" }} setSelectedMatch={setSelectedMatch} setModalOpen={setModalOpen} />
          </div>
          <div className="absolute" style={{ left: c0, top: r1_2 }}>
            <MatchBox match={{ id: 2, label: "Match 2", status: "completed", bracket: "upper" }} setSelectedMatch={setSelectedMatch} setModalOpen={setModalOpen} />
          </div>
          <div className="absolute" style={{ left: c0, top: r1_3 }}>
            <MatchBox match={{ id: 3, label: "Match 3", status: "completed", bracket: "upper" }} setSelectedMatch={setSelectedMatch} setModalOpen={setModalOpen} />
          </div>
          <div className="absolute" style={{ left: c0, top: r1_4 }}>
            <MatchBox match={{ id: 4, label: "Match 4", status: "completed", bracket: "upper" }} setSelectedMatch={setSelectedMatch} setModalOpen={setModalOpen} />
          </div>

          <div className="absolute" style={{ left: c1, top: r2_7 }}>
            <MatchBox match={{ id: 7, label: "Match 7", status: "completed", bracket: "upper" }} setSelectedMatch={setSelectedMatch} setModalOpen={setModalOpen} />
          </div>
          <div className="absolute" style={{ left: c1, top: r2_8 }}>
            <MatchBox match={{ id: 8, label: "Match 8", status: "next", bracket: "upper" }} setSelectedMatch={setSelectedMatch} setModalOpen={setModalOpen} />
          </div>
          <div className="absolute" style={{ left: c1, top: lower_5 }}>
            <MatchBox match={{ id: 5, label: "Match 5", status: "completed", bracket: "lower" }} setSelectedMatch={setSelectedMatch} setModalOpen={setModalOpen} />
          </div>
          <div className="absolute" style={{ left: c1, top: lower_6 }}>
            <MatchBox match={{ id: 6, label: "Match 6", status: "completed", bracket: "lower" }} setSelectedMatch={setSelectedMatch} setModalOpen={setModalOpen} />
          </div>

          <div className="absolute" style={{ left: c2, top: lower_9 }}>
            <MatchBox match={{ id: 9, label: "Match 9", status: "completed", bracket: "lower" }} setSelectedMatch={setSelectedMatch} setModalOpen={setModalOpen} />
          </div>
          <div className="absolute" style={{ left: c2, top: lower_10 }}>
            <MatchBox match={{ id: 10, label: "Match 10", status: "completed", bracket: "lower" }} setSelectedMatch={setSelectedMatch} setModalOpen={setModalOpen} />
          </div>

          <div className="absolute" style={{ left: c3, top: r3_11 }}>
            <MatchBox match={{ id: 11, label: "Match 11", status: "upcoming", bracket: "upper" }} setSelectedMatch={setSelectedMatch} setModalOpen={setModalOpen} />
          </div>
          <div className="absolute" style={{ left: c3, top: lower_12 }}>
            <MatchBox match={{ id: 12, label: "Match 12", status: "upcoming", bracket: "lower" }} setSelectedMatch={setSelectedMatch} setModalOpen={setModalOpen} />
          </div>

          <div className="absolute" style={{ left: c4, top: y13 }}>
            <MatchBox match={{ id: 13, label: "Match 13", status: "upcoming", bracket: "lower" }} setSelectedMatch={setSelectedMatch} setModalOpen={setModalOpen} />
          </div>

          <div className="absolute" style={{ left: c5, top: yFinals }}>
            <MatchBox match={{ id: 14, label: "FINALS", status: "upcoming" }} setSelectedMatch={setSelectedMatch} setModalOpen={setModalOpen} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------
   MAIN PAGE
-------------------------------------------------------- */
function ScoutFormContent() {
  const router = useRouter();
  const { userData } = useAuth();
  const showEventWarning = !isEventActive();

  const [notesOpen, setNotesOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalStep, setModalStep] = useState<"type" | "practice" | "qualification" | "finals">("type");
  const [finalsStep, setFinalsStep] = useState<"bracket" | "number">("bracket");
  const [selectedMatch, setSelectedMatch] = useState<{ id: number; type?: "qualification" | "practice" | "finals"; bracket?: "upper" | "lower" }>({ 
    id: 23, 
    type: "qualification" 
  });

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

function handleMatchSelect(id: number, bracket?: "upper" | "lower") {
  // When called from finals bracket, id is which position, bracket is upper/lower
  setSelectedMatch({ id: 0, type: "finals", bracket });
  setFinalsStep("number");
}

  const getMatchDisplay = () => {
    if (selectedMatch.type === "finals" && selectedMatch.bracket) {
      const bracketName = selectedMatch.bracket === "upper" ? "Upper" : "Lower";
      return `${bracketName} Bracket Match ${selectedMatch.id}`;
    } else if (selectedMatch.type === "practice") {
      return `Practice Match ${selectedMatch.id}`;
    } else {
      return `Qualification Match ${selectedMatch.id}`;
    }
  };

  const Counter = ({ label, value, onChange }: { label: string; value: number; onChange: (val: number) => void }) => (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onChange(Math.max(0, value - 1))}
          className="w-8 h-8 rounded bg-gray-200 hover:bg-gray-300 font-semibold"
        >
          −
        </button>
        <span className="w-8 text-center font-semibold">{value}</span>
        <button
          onClick={() => onChange(value + 1)}
          className="w-8 h-8 rounded bg-gray-200 hover:bg-gray-300 font-semibold"
        >
          +
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="min-h-screen bg-gray-100 flex flex-col md:flex-row justify-center">
      {/* LEFT COLUMN */}
      <div className="flex-1 p-4 space-y-6 max-w-3xl">
        {showEventWarning && (
          <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4">
            <p className="text-sm text-yellow-700">
              Note: Official scouting is only during events (Arkansas: March 18-21, Bayou: April 1-4).
            </p>
          </div>
        )}
        {/* MATCH SELECTOR HEADER */}
        <div
          className="bg-white rounded-xl shadow p-4 border-l-4"
          style={{ borderColor: "#c42221" }}
        >
          <div className="flex items-center gap-3">
            <span className="text-lg font-semibold">Assigned Match:</span>
            <span className="text-lg font-semibold" style={{ color: "#c42221" }}>
              {getMatchDisplay()}
            </span>
            <button
              onClick={() => {
                setModalStep("type");
                setModalOpen(true);
              }}
              className="px-2 py-0.5 text-xs rounded text-white"
              style={{ backgroundColor: "#c42221" }}
            >
              Fix
            </button>
          </div>
        </div>

        {/* SECTION 1: PRE-MATCH INFO */}
        <div className="bg-white rounded-xl shadow p-4">
          <h2 className="text-lg font-semibold mb-4" style={{ color: "#c42221" }}>
            Pre-Match Info
          </h2>
          
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Scout Name
              </label>
              <input
                type="text"
                value={formData.scoutName}
                disabled
                className="w-full border rounded p-2 bg-gray-100 text-gray-600"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Team Number
              </label>
              <select
                value={formData.teamNumber}
                onChange={(e) => setFormData({ ...formData, teamNumber: e.target.value })}
                className="w-full border rounded p-2"
              >
                <option value="">Select Team</option>
                <option value="1234">1234</option>
                <option value="5678">5678</option>
                <option value="9012">9012</option>
                <option value="3456">3456</option>
                <option value="7890">7890</option>
                <option value="1122">1122</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Starting Position
              </label>
              <select
                value={formData.startingPosition}
                onChange={(e) => setFormData({ ...formData, startingPosition: e.target.value })}
                className="w-full border rounded p-2"
              >
                <option value="">Select Position</option>
                <option value="not-there">Not There</option>
                <option value="processor">Processor Side</option>
                <option value="middle">Middle</option>
                <option value="opposite">Opposite Side</option>
              </select>
            </div>
          </div>
        </div>

        {/* SECTION 2: AUTONOMOUS */}
        <div className="bg-white rounded-xl shadow p-4">
          <h2 className="text-lg font-semibold mb-4" style={{ color: "#c42221" }}>
            Autonomous
          </h2>

          <div className="mb-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.leftStartingZone}
                onChange={(e) => setFormData({ ...formData, leftStartingZone: e.target.checked })}
                className="w-4 h-4"
              />
              <span className="text-sm font-medium text-gray-700">Left Starting Zone</span>
            </label>
          </div>

          <div className="border-t pt-3 mt-3">
            <h3 className="font-semibold text-base mb-2 text-gray-800">Auto Coral</h3>
            <Counter label="Missed Attempts" value={formData.autoCoralMissed} onChange={(val) => setFormData({ ...formData, autoCoralMissed: val })} />
            <Counter label="Level 1" value={formData.autoCoralL1} onChange={(val) => setFormData({ ...formData, autoCoralL1: val })} />
            <Counter label="Level 2" value={formData.autoCoralL2} onChange={(val) => setFormData({ ...formData, autoCoralL2: val })} />
            <Counter label="Level 3" value={formData.autoCoralL3} onChange={(val) => setFormData({ ...formData, autoCoralL3: val })} />
            <Counter label="Level 4" value={formData.autoCoralL4} onChange={(val) => setFormData({ ...formData, autoCoralL4: val })} />
          </div>

          <div className="border-t pt-3 mt-3">
            <h3 className="font-semibold text-base mb-2 text-gray-800">Auto Algae Processor</h3>
            <Counter label="Missed Attempts" value={formData.autoAlgaeProcessorMissed} onChange={(val) => setFormData({ ...formData, autoAlgaeProcessorMissed: val })} />
            <Counter label="Scored" value={formData.autoAlgaeProcessorScored} onChange={(val) => setFormData({ ...formData, autoAlgaeProcessorScored: val })} />
          </div>

          <div className="border-t pt-3 mt-3">
            <h3 className="font-semibold text-base mb-2 text-gray-800">Auto Algae Net</h3>
            <Counter label="Missed Attempts" value={formData.autoAlgaeNetMissed} onChange={(val) => setFormData({ ...formData, autoAlgaeNetMissed: val })} />
            <Counter label="Scored" value={formData.autoAlgaeNetScored} onChange={(val) => setFormData({ ...formData, autoAlgaeNetScored: val })} />
          </div>
        </div>

        {/* SECTION 3: TELEOP */}
        <div className="bg-white rounded-xl shadow p-4">
          <h2 className="text-lg font-semibold mb-4" style={{ color: "#c42221" }}>
            Teleop
          </h2>

          <div className="border-b pb-3 mb-3">
            <h3 className="font-semibold text-base mb-2 text-gray-800">Teleop Coral</h3>
            <Counter label="Missed Attempts" value={formData.teleopCoralMissed} onChange={(val) => setFormData({ ...formData, teleopCoralMissed: val })} />
            <Counter label="Level 1" value={formData.teleopCoralL1} onChange={(val) => setFormData({ ...formData, teleopCoralL1: val })} />
            <Counter label="Level 2" value={formData.teleopCoralL2} onChange={(val) => setFormData({ ...formData, teleopCoralL2: val })} />
            <Counter label="Level 3" value={formData.teleopCoralL3} onChange={(val) => setFormData({ ...formData, teleopCoralL3: val })} />
            <Counter label="Level 4" value={formData.teleopCoralL4} onChange={(val) => setFormData({ ...formData, teleopCoralL4: val })} />
          </div>

          <div className="mb-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.teleopAlgaeRemoved}
                onChange={(e) => setFormData({ ...formData, teleopAlgaeRemoved: e.target.checked })}
                className="w-4 h-4"
              />
              <span className="text-sm font-medium text-gray-700">Removed Algae from Reef</span>
            </label>
          </div>

          <div className="border-t pt-3 mt-3">
            <h3 className="font-semibold text-base mb-2 text-gray-800">Teleop Processor</h3>
            <Counter label="Missed Attempts" value={formData.teleopProcessorMissed} onChange={(val) => setFormData({ ...formData, teleopProcessorMissed: val })} />
            <Counter label="Scored" value={formData.teleopProcessorScored} onChange={(val) => setFormData({ ...formData, teleopProcessorScored: val })} />
          </div>

          <div className="border-t pt-3 mt-3">
            <h3 className="font-semibold text-base mb-2 text-gray-800">Teleop Algae Net – Robot</h3>
            <Counter label="Missed Attempts" value={formData.teleopNetRobotMissed} onChange={(val) => setFormData({ ...formData, teleopNetRobotMissed: val })} />
            <Counter label="Scored" value={formData.teleopNetRobotScored} onChange={(val) => setFormData({ ...formData, teleopNetRobotScored: val })} />
          </div>

          <div className="border-t pt-3 mt-3">
            <h3 className="font-semibold text-base mb-2 text-gray-800">Teleop Algae Net – Human Player</h3>
            <Counter label="Missed Attempts" value={formData.teleopNetHumanMissed} onChange={(val) => setFormData({ ...formData, teleopNetHumanMissed: val })} />
            <Counter label="Scored" value={formData.teleopNetHumanScored} onChange={(val) => setFormData({ ...formData, teleopNetHumanScored: val })} />
          </div>
        </div>

        {/* SECTION 4: ENDGAME */}
        <div className="bg-white rounded-xl shadow p-4">
          <h2 className="text-lg font-semibold mb-4" style={{ color: "#c42221" }}>
            Endgame
          </h2>

          <Counter label="Failed Climb" value={formData.failedClimb} onChange={(val) => setFormData({ ...formData, failedClimb: val })} />

          <div className="mt-3">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Stage Status
            </label>
            <select
              value={formData.stageStatus}
              onChange={(e) => setFormData({ ...formData, stageStatus: e.target.value })}
              className="w-full border rounded p-2"
            >
              <option value="">Select Status</option>
              <option value="not-parked">Not Parked</option>
              <option value="barge">Parked in Barge Zone</option>
              <option value="shallow">Shallow Cage</option>
              <option value="deep">Deep Cage</option>
            </select>
          </div>
        </div>

        {/* SECTION 5: GENERAL */}
        <div className="bg-white rounded-xl shadow p-4">
          <h2 className="text-lg font-semibold mb-4" style={{ color: "#c42221" }}>
            General
          </h2>

          <div className="mb-4">
            <h3 className="font-semibold text-base mb-2 text-gray-800">Things That Occurred</h3>
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
                <label key={incident.value} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.incidents.includes(incident.value)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setFormData({ ...formData, incidents: [...formData.incidents, incident.value] });
                      } else {
                        setFormData({ ...formData, incidents: formData.incidents.filter(i => i !== incident.value) });
                      }
                    }}
                    className="w-4 h-4"
                  />
                  <span className="text-sm text-gray-700">{incident.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* SUBMIT */}
        <div className="bg-white rounded-xl shadow p-4">
          <button
            className="w-full py-3 rounded text-white font-semibold"
            style={{ backgroundColor: "#c42221" }}
            onClick={async () => {
              try {
                // Add to Firebase with proper labels
                const { addDoc, collection } = await import("firebase/firestore");
                const { db } = await import("@/app/firebase");
                
                const matchPrefix = selectedMatch.type === "practice"
                  ? "p"
                  : selectedMatch.type === "finals"
                  ? "f"
                  : "q";
                const matchId = `${matchPrefix}${selectedMatch.id}`;
                const submission = {
                  ...formData,
                  matchId,
                  matchNumber: selectedMatch.id.toString(),
                  matchType: selectedMatch.type || "qualification",
                  bracket: selectedMatch.bracket || null,
                  timestamp: Date.now(),
                  submittedAt: Date.now(), // Track when form was submitted for event filtering
                };
                
                await addDoc(collection(db, "scouting"), submission);
                alert("Scouting report submitted successfully!");
                
                // Reset form
                setFormData({
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
                  incidents: [],
                  notes: "",
                });
              } catch (error) {
                console.error("Error submitting:", error);
                alert("Error submitting report. Check console.");
              }
            }}
          >
            Submit Scouting Report
          </button>
        </div>
      </div>

      {/* RIGHT COLUMN — NOTES PANEL (DESKTOP) */}
      <div className="hidden md:block w-80 p-4">
        <div className="bg-white rounded-xl shadow p-4 flex flex-col" style={{ height: 'calc(100vh - 2rem)' }}>
          <h2 className="text-xl font-semibold mb-2" style={{ color: "#c42221" }}>
            Notes
          </h2>
          <textarea
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            className="flex-1 border rounded p-2 resize-none"
            placeholder="Write notes here..."
          />
        </div>
      </div>

      {/* MOBILE NOTES DRAWER */}
      <div className="md:hidden fixed right-0 top-1/2 transform -translate-y-1/2 z-40">
        <button
          onClick={() => setNotesOpen(!notesOpen)}
          className="px-2 py-4 rounded-l-xl text-white"
          style={{ backgroundColor: "#c42221" }}
        >
          {notesOpen ? "→" : "←"}
        </button>

        {notesOpen && (
          <div className="fixed right-0 top-0 h-full w-64 bg-white shadow-xl p-4 z-50">
            <h2 className="text-xl font-semibold mb-2" style={{ color: "#c42221" }}>
              Notes
            </h2>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              className="w-full h-[85%] border rounded p-2 resize-none"
              placeholder="Write notes here..."
            />
          </div>
        )}
      </div>

      {/* MODAL CONTENT — MATCH SELECTION FLOW */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        step={modalStep}
      >
        {/* STEP 1 — SELECT MATCH TYPE */}
        {modalStep === "type" && (
          <>
            <h2 className="text-xl font-semibold mb-4" style={{ color: "#c42221" }}>
              Select Match Type
            </h2>

            <div className="space-y-3">
              <button
                onClick={() => setModalStep("practice")}
                className="w-full py-2 rounded text-white"
                style={{ backgroundColor: "#c42221" }}
              >
                Practice
              </button>

              <button
                onClick={() => setModalStep("qualification")}
                className="w-full py-2 rounded text-white"
                style={{ backgroundColor: "#c42221" }}
              >
                Qualification
              </button>

              <button
                onClick={() => setModalStep("finals")}
                className="w-full py-2 rounded text-white"
                style={{ backgroundColor: "#c42221" }}
              >
                Finals
              </button>
            </div>
          </>
        )}

        {/* STEP 2 — PRACTICE MATCH */}
        {modalStep === "practice" && (
          <>
            <h2 className="text-xl font-semibold mb-4" style={{ color: "#c42221" }}>
              Practice Match
            </h2>

            <p className="text-gray-600 mb-4">
              Practice matches are unscheduled. Enter match number manually.
            </p>

            <input
              type="number"
              placeholder="Practice Match #"
              className="w-full border rounded p-2 mb-4"
              id="practiceMatchInput"
            />

            <button
              className="w-full py-2 rounded text-white"
              style={{ backgroundColor: "#c42221" }}
              onClick={() => {
                const input = document.getElementById("practiceMatchInput") as HTMLInputElement;
                const matchNum = parseInt(input.value);
                if (matchNum && matchNum > 0) {
                  setSelectedMatch({ id: matchNum, type: "practice" });
                  setModalOpen(false);
                }
              }}
            >
              Confirm
            </button>
          </>
        )}

        {/* STEP 3 — QUALIFICATION */}
        {modalStep === "qualification" && (
          <>
            <h2
              className="text-xl font-semibold mb-4"
              style={{ color: "#c42221" }}
            >
              Qualification Matches
            </h2>

            {(() => {
              const currentMatch = 67;
              const totalMatches = 80;

              const baseTime = new Date();
              baseTime.setHours(9, 0, 0, 0);

              const schedule = Array.from({ length: totalMatches }, (_, i) => {
                const matchNum = i + 1;
                const matchTime = new Date(
                  baseTime.getTime() + i * 7 * 60000
                );

                const timeString = matchTime.toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                });

                let status: MatchStatus = "upcoming";
                if (matchNum < currentMatch) status = "completed";
                else if (matchNum === currentMatch) status = "next";

                return { matchNum, timeString, status };
              });

              const borderColors: Record<MatchStatus, string> = {
                completed: "border-green-500",
                next: "border-yellow-500",
                upcoming: "border-red-500",
              };

              const badgeColors: Record<MatchStatus, string> = {
                completed: "bg-green-500",
                next: "bg-yellow-500",
                upcoming: "bg-red-500",
              };

              const badgeText: Record<MatchStatus, string> = {
                completed: "Done",
                next: "Next",
                upcoming: "Up",
              };

              return (
                <div className="grid grid-cols-3 gap-2 max-h-[60vh] overflow-y-auto pr-1">
                  {schedule.map(({ matchNum, timeString, status }) => (
                    <button
                      key={matchNum}
                      onClick={() => {
                        setSelectedMatch({ id: matchNum, type: "qualification" });
                        setModalOpen(false);
                      }}
                      className={`
                        relative p-2 rounded-lg border text-left
                        ${borderColors[status]}
                        hover:bg-gray-50
                      `}
                    >
                      <div
                        className={`
                          absolute top-0.5 left-0.5 text-[10px] px-1 py-0.5 rounded-full text-white
                          ${badgeColors[status]}
                        `}
                      >
                        {badgeText[status]}
                      </div>

                      <div className="mt-3">
                        <div className="font-semibold text-sm">
                          Qualification {matchNum}
                        </div>
                        <div className="text-xs text-gray-600">
                          {timeString}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              );
            })()}

            <button
              className="w-full mt-4 py-2 rounded text-white"
              style={{ backgroundColor: "#c42221" }}
              onClick={() => setModalOpen(false)}
            >
              Close
            </button>
          </>
        )}

        {/* STEP 4 — FINALS */}
        {modalStep === "finals" && finalsStep === "bracket" && (
          <FinalsBracket
            setSelectedMatch={handleMatchSelect}
            setModalOpen={setModalOpen}
          />
        )}
        
        {modalStep === "finals" && finalsStep === "number" && (
          <>
            <div className="flex items-center justify-between mb-6">
              <button
                onClick={() => {
                  setFinalsStep("bracket");
                  setSelectedMatch({ id: 0, type: "qualification" });
                }}
                className="text-gray-600 hover:text-gray-900 flex items-center gap-2"
              >
                ← Back to Bracket
              </button>
              <h2 className="text-xl font-semibold">
                Select Finals Match Number
              </h2>
              <div className="w-32"></div>
            </div>

            <p className="text-gray-600 mb-6 text-center">
              Which finals match are you scouting?<br/>
              <span className="text-sm">
                ({selectedMatch.bracket === "upper" ? "Upper" : "Lower"} Bracket Finals)
              </span>
            </p>

            <div className="grid grid-cols-3 gap-6 max-w-2xl mx-auto">
              {[14, 15, 16].map(matchNum => (
                <button
                  key={matchNum}
                  onClick={() => {
                    setSelectedMatch(prev => ({
                      ...prev,
                      id: matchNum
                    }));
                    setModalOpen(false);
                    setModalStep("type");
                    setFinalsStep("bracket");
                  }}
                  className="group relative p-8 border-2 border-gray-300 rounded-2xl hover:border-red-500 hover:bg-red-50 transition-all hover:shadow-lg"
                >
                  <div className="text-center">
                    <div className="text-5xl font-bold mb-3 group-hover:scale-110 transition-transform" style={{ color: "#c42221" }}>
                      {matchNum}
                    </div>
                    <div className="text-sm font-medium text-gray-600 group-hover:text-gray-900">
                      Finals Match {matchNum}
                    </div>
                    <div className="text-xs text-gray-500 mt-2">
                      {matchNum === 14 && "First Finals"}
                      {matchNum === 15 && "Second Finals"}
                      {matchNum === 16 && "Third Finals (if needed)"}
                    </div>
                  </div>
                </button>
              ))}
            </div>

            <p className="text-center text-sm text-gray-500 mt-6">
              Select the specific finals match you're scouting
            </p>
          </>
        )}
      </Modal>
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["coach", "scout"]}>
      <ScoutFormContent />
    </ProtectedRoute>
  );
}

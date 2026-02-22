"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Hourglass, X as XIcon } from "lucide-react";
import ReefscapeStyleModal from "@/app/components/ReefscapeStyleModal";

export type MatchType = "practice" | "qualification" | "finals";

export type ReefscapeMatchOption = {
  id: string;
  label: string;
  type: MatchType;
  matchNumber: number;
  scheduleTime: number;
};

type MatchStatus = "completed" | "next" | "upcoming";

function FinalsMatchBox({
  number,
  row,
  col,
  status,
  onPick,
  label,
}: {
  number: number;
  row: number;
  col: number;
  status: MatchStatus;
  onPick: (matchNumber: number) => void;
  label?: string;
}) {
  const borderStyles: Record<MatchStatus, React.CSSProperties> = {
    completed: { borderColor: "#16a34a" },
    next: { borderColor: "#ca8a04" },
    upcoming: { borderColor: "#ef4444" },
  };
  const badgeBg: Record<MatchStatus, string> = {
    completed: "#16a34a",
    next: "#ca8a04",
    upcoming: "#ef4444",
  };

  return (
    <button
      type="button"
      onClick={() => {
        if (status === "completed") return;
        onPick(number);
      }}
      disabled={status === "completed"}
      className={`absolute w-[120px] min-h-[62px] text-xs rounded border text-left bg-white ${
        status === "completed" ? "opacity-45 cursor-not-allowed bg-gray-100 border-gray-300" : "hover:bg-gray-50"
      }`}
      style={{ left: col, top: row, ...(status === "completed" ? {} : borderStyles[status]) }}
    >
      <div
        className="absolute top-0.5 right-0.5 text-[10px] px-1 py-0.5 rounded-full text-white inline-flex items-center justify-center"
        style={{ backgroundColor: badgeBg[status] }}
      >
        {status === "completed" ? <Check size={10} /> : status === "next" ? <Hourglass size={10} /> : <XIcon size={10} />}
      </div>
      <div className="pt-1.5 pb-1 px-1.5">
        <div className="font-semibold text-[11px] leading-tight">{label || `Match ${number}`}</div>
      </div>
    </button>
  );
}

function FinalsBracket({
  completed,
  onPick,
}: {
  completed: Set<string>;
  onPick: (matchNumber: number) => void;
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
  const totalWidth = c5 + B.w;
  const firstOpen = Array.from({ length: 14 }, (_, i) => i + 1).find((n) => !completed.has(`f${n}`)) || -1;
  const statusOf = (n: number): MatchStatus => (completed.has(`f${n}`) ? "completed" : n === firstOpen ? "next" : "upcoming");

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
        <div className="relative" style={{ width: totalWidth, height: 600 }}>
          <svg className="absolute inset-0 pointer-events-none overflow-visible" width={totalWidth} height={600}>
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
          <FinalsMatchBox number={1} row={r1_1} col={c0} status={statusOf(1)} onPick={onPick} />
          <FinalsMatchBox number={2} row={r1_2} col={c0} status={statusOf(2)} onPick={onPick} />
          <FinalsMatchBox number={3} row={r1_3} col={c0} status={statusOf(3)} onPick={onPick} />
          <FinalsMatchBox number={4} row={r1_4} col={c0} status={statusOf(4)} onPick={onPick} />
          <FinalsMatchBox number={5} row={lower_5} col={c1} status={statusOf(5)} onPick={onPick} />
          <FinalsMatchBox number={6} row={lower_6} col={c1} status={statusOf(6)} onPick={onPick} />
          <FinalsMatchBox number={7} row={r2_7} col={c1} status={statusOf(7)} onPick={onPick} />
          <FinalsMatchBox number={8} row={r2_8} col={c1} status={statusOf(8)} onPick={onPick} />
          <FinalsMatchBox number={9} row={lower_9} col={c2} status={statusOf(9)} onPick={onPick} />
          <FinalsMatchBox number={10} row={lower_10} col={c2} status={statusOf(10)} onPick={onPick} />
          <FinalsMatchBox number={11} row={r3_11} col={c3} status={statusOf(11)} onPick={onPick} />
          <FinalsMatchBox number={12} row={lower_12} col={c3} status={statusOf(12)} onPick={onPick} />
          <FinalsMatchBox number={13} row={y13} col={c4} status={statusOf(13)} onPick={onPick} />
          <FinalsMatchBox
            number={14}
            row={yFinals}
            col={c5}
            label="FINALS"
            status={completed.has("f1") && completed.has("f2") && completed.has("f3") ? "completed" : "upcoming"}
            onPick={onPick}
          />
        </div>
      </div>
    </div>
  );
}

export default function ReefscapeMatchSelectModal<T extends ReefscapeMatchOption>({
  open,
  onClose,
  options,
  completed = new Set<string>(),
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  options: T[];
  completed?: Set<string>;
  onPick: (option: T) => void;
}) {
  const [step, setStep] = useState<"type" | MatchType>("type");
  const [finalsStep, setFinalsStep] = useState<"bracket" | "number">("bracket");

  useEffect(() => {
    if (!open) {
      setStep("type");
      setFinalsStep("bracket");
    }
  }, [open]);

  const current = useMemo(() => options.filter((m) => m.type === step), [options, step]);
  const firstOpen = current.find((m) => !completed.has(m.id))?.id || "";
  const finalsById = useMemo(() => new Map(options.filter((m) => m.type === "finals").map((m) => [m.id, m] as const)), [options]);
  const finalsByNumber = useMemo(() => {
    const map = new Map<number, T>();
    options
      .filter((m) => m.type === "finals")
      .forEach((m) => {
        if (!map.has(m.matchNumber)) map.set(m.matchNumber, m);
      });
    return map;
  }, [options]);
  function isFinalDone(matchNumber: number) {
    if (completed.has(`f${matchNumber}`)) return true;
    const opt = finalsByNumber.get(matchNumber);
    return !!opt && completed.has(opt.id);
  }
  return (
    <ReefscapeStyleModal open={open} onClose={onClose} step={step}>
      {step === "type" ? (
        <>
          <h2 className="text-xl font-semibold mb-4" style={{ color: "var(--primary-color)" }}>Select Match Type</h2>
          <div className="space-y-3">
            <button type="button" className="w-full py-2 rounded text-white" style={{ backgroundColor: "var(--primary-color)" }} onClick={() => setStep("practice")}>Practice</button>
            <button type="button" className="w-full py-2 rounded text-white" style={{ backgroundColor: "var(--primary-color)" }} onClick={() => setStep("qualification")}>Qualification</button>
            <button type="button" className="w-full py-2 rounded text-white" style={{ backgroundColor: "var(--primary-color)" }} onClick={() => setStep("finals")}>Finals</button>
          </div>
        </>
      ) : (
        <>
          {(step === "practice" || step === "qualification") && (
            <>
              <h2 className="text-xl font-semibold mb-4" style={{ color: "var(--primary-color)" }}>
                {step === "practice" ? "Practice Matches" : "Qualification Matches"}
              </h2>
              <div className="grid grid-cols-3 gap-2 max-h-[60vh] overflow-y-auto pr-1">
                {current.length === 0 && (
                  <div className="col-span-full border rounded p-3 text-sm text-gray-600">
                    No matches available for this type yet.
                  </div>
                )}
                {current.map((m) => {
                  const done = completed.has(m.id);
                  const status: MatchStatus = done ? "completed" : m.id === firstOpen ? "next" : "upcoming";
                  const color = status === "completed" ? "#16a34a" : status === "next" ? "#ca8a04" : "#ef4444";
                  return (
                    <button
                      key={m.id}
                      type="button"
                      disabled={done}
                      onClick={() => {
                        if (done) return;
                        onPick(m);
                        onClose();
                      }}
                      className={`relative h-[86px] p-2 rounded-lg border text-left ${done ? "opacity-45 cursor-not-allowed bg-gray-100 border-gray-300" : "hover:bg-gray-50"}`}
                      style={done ? undefined : { borderColor: color }}
                    >
                      <div className="absolute top-0.5 left-0.5 text-[10px] px-1 py-0.5 rounded-full text-white inline-flex items-center justify-center" style={{ backgroundColor: color }}>
                        {status === "completed" ? <Check size={10} /> : status === "next" ? <Hourglass size={10} /> : <XIcon size={10} />}
                      </div>
                      <div className="mt-3">
                        <div className="font-semibold text-sm">{m.label}</div>
                        <div className="text-xs text-gray-600">{m.scheduleTime > 0 ? new Date(m.scheduleTime * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "TBD"}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
              <button type="button" className="w-full mt-4 py-2 rounded text-white" style={{ backgroundColor: "var(--primary-color)" }} onClick={onClose}>
                Close
              </button>
            </>
          )}

          {step === "finals" && (
            <>
              {finalsStep === "bracket" && (
                <FinalsBracket
                  completed={new Set(
                    Array.from({ length: 14 }, (_, i) => i + 1)
                      .filter((n) => isFinalDone(n))
                      .map((n) => `f${n}`)
                  )}
                  onPick={(matchNumber) => {
                    if (matchNumber === 14) {
                      setFinalsStep("number");
                      return;
                    }
                    const picked = finalsByNumber.get(matchNumber) || finalsById.get(`f${matchNumber}`);
                    if (picked) {
                      onPick(picked);
                      onClose();
                      return;
                    }
                    const fallback = {
                      id: `f${matchNumber}`,
                      label: `Finals ${matchNumber}`,
                      type: "finals",
                      matchNumber,
                      scheduleTime: 0,
                    } as T;
                    onPick(fallback);
                    onClose();
                  }}
                />
              )}
              {finalsStep === "number" && (
                <>
                  <div className="flex items-center justify-between mb-6">
                    <button type="button" onClick={() => setFinalsStep("bracket")} className="text-gray-600 hover:text-gray-900 flex items-center gap-2">
                      ← Back to Bracket
                    </button>
                    <h2 className="text-xl font-semibold">Select Finals Match Number</h2>
                    <div className="w-32" />
                  </div>
                  <p className="text-gray-600 mb-6 text-center">Which finals match are you scouting?</p>
                  <div className="grid grid-cols-3 gap-6 max-w-2xl mx-auto">
                    {[1, 2, 3].map((matchNum) => (
                      <button
                        key={matchNum}
                        type="button"
                        onClick={() => {
                          const picked = finalsByNumber.get(matchNum) || finalsById.get(`f${matchNum}`);
                          if (picked) {
                            onPick(picked);
                            onClose();
                            return;
                          }
                          const fallback = {
                            id: `f${matchNum}`,
                            label: `Finals ${matchNum}`,
                            type: "finals",
                            matchNumber: matchNum,
                            scheduleTime: 0,
                          } as T;
                          onPick(fallback);
                          onClose();
                        }}
                        disabled={isFinalDone(matchNum)}
                        className={`group relative p-8 border-2 border-gray-300 rounded-2xl transition-all ${isFinalDone(matchNum) ? "opacity-45 cursor-not-allowed bg-gray-100" : "hover:border-red-500 hover:bg-red-50 hover:shadow-lg"}`}
                      >
                        <div className="text-center">
                          <div className="text-5xl font-bold mb-3 group-hover:scale-110 transition-transform" style={{ color: "var(--primary-color)" }}>
                            F{matchNum}
                          </div>
                          <div className="text-sm font-medium text-gray-600 group-hover:text-gray-900">{`Finals ${matchNum}`}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
    </ReefscapeStyleModal>
  );
}

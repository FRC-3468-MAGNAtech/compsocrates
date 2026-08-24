"use client";

import { useEffect, useState } from "react";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { db } from "@/app/firebase";
import { useAuth } from "@/app/AuthContext";
import { flagStateDocId, type FlagEntityType, type StoredFlagState } from "@/app/utils/scoutingFlags";

const MANUAL_FLAG_REASONS = [
  { value: "no-teleop-score", label: "No teleop score" },
  { value: "excessive-auto-score", label: "Excessive auto score" },
  { value: "excessive-human-player-score", label: "Excessive human player score" },
  { value: "other", label: "Other / coach review" },
];

type AnalyticsConfigModalProps = {
  open: boolean;
  onClose: () => void;
  entryId: string;
  entryLabel: string;
  entrySubtitle?: string;
  collectionName: string;
  entityType: FlagEntityType;
  excludeFromStats?: boolean;
  onExcludeChange?: (next: boolean) => void;
};

export default function AnalyticsConfigModal({
  open,
  onClose,
  entryId,
  entryLabel,
  entrySubtitle,
  collectionName,
  entityType,
  excludeFromStats = false,
  onExcludeChange,
}: AnalyticsConfigModalProps) {
  const { userData } = useAuth();
  const [flagState, setFlagState] = useState<StoredFlagState | null>(null);
  const [manualFlagReason, setManualFlagReason] = useState<string>(MANUAL_FLAG_REASONS[0].value);
  const [savingFlag, setSavingFlag] = useState(false);
  const [savingExclude, setSavingExclude] = useState(false);

  useEffect(() => {
    if (!open || !entryId) return;
    let active = true;
    setFlagState(null);
    setManualFlagReason(MANUAL_FLAG_REASONS[0].value);
    async function loadFlagState() {
      try {
        const snap = await getDoc(doc(db, "scoutingFlagStates", flagStateDocId(entityType, entryId)));
        if (!active) return;
        if (snap.exists()) {
          const data = snap.data() as StoredFlagState;
          setFlagState(data);
          if (data.manualReason) setManualFlagReason(String(data.manualReason));
        }
      } catch (error) {
        console.warn("Unable to load config state:", error);
      }
    }
    void loadFlagState();
    return () => {
      active = false;
    };
  }, [open, entryId, entityType]);

  if (!open) return null;

  const stateId = flagStateDocId(entityType, entryId);
  const isManualFlagged = Boolean(flagState?.manualFlagged);

  async function updateManualFlag(enabled: boolean) {
    if (!userData?.teamId) {
      alert("Missing team information for this action.");
      return;
    }
    setSavingFlag(true);
    try {
      const payload: Record<string, unknown> = {
        teamId: userData.teamId,
        entityType,
        entityId: entryId,
        dismissed: flagState?.dismissed ?? false,
        manualFlagged: enabled,
      };
      if (enabled) {
        payload.manualReason = manualFlagReason;
        payload.manualFlaggedAt = Date.now();
        payload.manualFlaggedBy = userData?.uid || "";
      } else {
        payload.manualReason = "";
        payload.manualFlaggedAt = null;
        payload.manualFlaggedBy = "";
      }
      await setDoc(doc(db, "scoutingFlagStates", stateId), payload, { merge: true });
      setFlagState((prev) => ({
        ...(prev || {
          entityType,
          entityId: entryId,
          dismissed: false,
        }),
        manualFlagged: enabled,
        manualReason: enabled ? manualFlagReason : "",
      }));
    } catch (error) {
      console.error("Failed updating manual flag:", error);
      alert("Could not update manual flag.");
    } finally {
      setSavingFlag(false);
    }
  }

  async function toggleExclude() {
    if (!userData?.teamId) {
      alert("Missing team information for this action.");
      return;
    }
    const next = !excludeFromStats;
    setSavingExclude(true);
    try {
      await updateDoc(doc(db, collectionName, entryId), {
        excludeFromStats: next,
        excludeFromStatsAt: Date.now(),
        excludeFromStatsBy: userData?.uid || "",
      });
      onExcludeChange?.(next);
    } catch (error) {
      console.error("Failed updating stats exclusion:", error);
      alert("Could not update stats exclusion.");
    } finally {
      setSavingExclude(false);
    }
  }

  const manualReasonLabel =
    MANUAL_FLAG_REASONS.find((reason) => reason.value === manualFlagReason)?.label || "Manual flag";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-4 backdrop-blur-sm">
      <div className="glass-surface-raised w-full max-w-lg rounded-[1.75rem] p-6">
        <div className="space-y-5">
          <div>
            <h2 className="font-display text-2xl text-slate-950">Entry Config</h2>
            <p className="mt-1 font-data text-sm text-slate-700">{entryLabel}</p>
            {entrySubtitle && <p className="font-data text-xs text-slate-500">{entrySubtitle}</p>}
          </div>

          <div className="space-y-2.5 rounded-2xl border border-amber-300/40 bg-white/40 p-4">
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-red-800/80">Manual Flag</div>
            {isManualFlagged && (
              <p className="text-sm text-slate-700">
                Current reason: <span className="font-semibold">{manualReasonLabel}</span>
              </p>
            )}
            <label className="block text-xs font-semibold text-slate-600">
              Reason
              <select
                value={manualFlagReason}
                onChange={(event) => setManualFlagReason(event.target.value)}
                className="mt-1 w-full text-sm"
              >
                {MANUAL_FLAG_REASONS.map((reason) => (
                  <option key={reason.value} value={reason.value}>
                    {reason.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={() => void updateManualFlag(true)}
                disabled={savingFlag}
                className="inline-flex items-center rounded-full border border-red-800/50 bg-gradient-to-br from-red-700 to-red-900 px-4 py-2 text-xs font-bold text-white shadow-[0_10px_30px_rgba(139,0,0,0.24)] disabled:opacity-50"
              >
                {isManualFlagged ? "Update Manual Flag" : "Add Manual Flag"}
              </button>
              {isManualFlagged && (
                <button
                  type="button"
                  onClick={() => void updateManualFlag(false)}
                  disabled={savingFlag}
                  className="inline-flex items-center rounded-full border border-white/70 bg-white/50 px-4 py-2 text-xs font-bold text-slate-700 disabled:opacity-50"
                >
                  Remove Manual Flag
                </button>
              )}
            </div>
          </div>

          <div className="space-y-2.5 rounded-2xl border border-amber-300/40 bg-white/40 p-4">
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-red-800/80">Stats Exclusion</div>
            <p className="text-sm text-slate-600">
              Excluded entries stay visible here but will be ignored by stats and averages.
            </p>
            <button
              type="button"
              onClick={() => void toggleExclude()}
              disabled={savingExclude}
              className={`inline-flex items-center rounded-full border px-4 py-2 text-xs font-bold disabled:opacity-50 ${
                excludeFromStats
                  ? "border-emerald-400/60 bg-emerald-50/70 text-emerald-900"
                  : "border-white/70 bg-white/50 text-slate-700"
              }`}
            >
              {excludeFromStats ? "Include In Stats" : "Exclude From Stats"}
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-full border border-amber-300/70 bg-white/45 py-2.5 text-sm font-bold text-amber-950 shadow-[0_8px_30px_rgba(212,175,55,0.16)] hover:bg-amber-50/70"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

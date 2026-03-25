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
    <div className="fixed inset-0 bg-black/45 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
        <div className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold">Config</h2>
            <p className="text-sm text-gray-600">{entryLabel}</p>
            {entrySubtitle && <p className="text-xs text-gray-500">{entrySubtitle}</p>}
          </div>

          <div className="space-y-2">
            <div className="font-semibold">Manual Flag</div>
            {isManualFlagged && (
              <p className="text-sm text-gray-700">
                Current reason: <span className="font-semibold">{manualReasonLabel}</span>
              </p>
            )}
            <label className="block text-sm font-medium text-gray-700">
              Reason
              <select
                value={manualFlagReason}
                onChange={(event) => setManualFlagReason(event.target.value)}
                className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
              >
                {MANUAL_FLAG_REASONS.map((reason) => (
                  <option key={reason.value} value={reason.value}>
                    {reason.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void updateManualFlag(true)}
                disabled={savingFlag}
                className="px-3 py-1 rounded border border-red-300 bg-red-50 text-red-900 text-sm disabled:opacity-50"
              >
                {isManualFlagged ? "Update Manual Flag" : "Add Manual Flag"}
              </button>
              {isManualFlagged && (
                <button
                  type="button"
                  onClick={() => void updateManualFlag(false)}
                  disabled={savingFlag}
                  className="px-3 py-1 rounded border border-gray-300 bg-gray-50 text-gray-800 text-sm disabled:opacity-50"
                >
                  Remove Manual Flag
                </button>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <div className="font-semibold">Stats Exclusion</div>
            <p className="text-sm text-gray-600">
              Excluded entries stay visible here but will be ignored by stats and averages.
            </p>
            <button
              type="button"
              onClick={() => void toggleExclude()}
              disabled={savingExclude}
              className={`px-3 py-1 rounded border text-sm disabled:opacity-50 ${
                excludeFromStats ? "border-green-300 bg-green-50 text-green-900" : "border-gray-300 bg-gray-50 text-gray-800"
              }`}
            >
              {excludeFromStats ? "Include In Stats" : "Exclude From Stats"}
            </button>
          </div>

          <div>
            <button
              type="button"
              onClick={onClose}
              className="w-full py-2 rounded text-white font-semibold"
              style={{ backgroundColor: "var(--primary-color)" }}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

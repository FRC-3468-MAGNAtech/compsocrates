"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";
import { db } from "@/app/firebase";
import { getEffectiveNowMs, toLocalDateTimeInputValue } from "@/app/utils/teamTime";
import { getEventsForGame, type AnalyticsGame } from "@/app/utils/analyticsEvents";

type ScoutingEditDraft = {
  id: string;
  game: AnalyticsGame;
  eventKey: string;
  eventName: string;
  matchType: "practice" | "qualification" | "finals";
  matchNumber: string;
  teamNumber: string;
  isPracticeScouting: boolean;
  practiceMode?: string;
  practiceSessionId?: string;
  isLivePracticeScouting?: boolean;
};

type OwnerManagedUser = {
  uid: string;
  email: string;
  displayName: string;
  teamId?: string;
  role?: string;
  emailVerificationExempt?: boolean;
};

function coerceMatchType(value: string): "practice" | "qualification" | "finals" {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "practice") return "practice";
  if (raw === "finals" || raw === "final") return "finals";
  return "qualification";
}

function matchTypeFromId(matchId: string): "practice" | "qualification" | "finals" {
  const raw = String(matchId || "").trim().toLowerCase();
  if (raw.startsWith("p")) return "practice";
  if (raw.startsWith("f")) return "finals";
  return "qualification";
}

function parseMatchNumber(value: string): string {
  const numeric = String(value || "").match(/\d+/)?.[0] || "";
  return numeric.replace(/^0+/, "") || (numeric ? "0" : "");
}

function parseTeamNumber(value: string): string {
  const numeric = String(value || "").match(/\d+/)?.[0] || "";
  return numeric.replace(/^0+/, "") || (numeric ? "0" : "");
}

function parseBulkIds(raw: string): string[] {
  const unique = new Set<string>();
  String(raw || "")
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean)
    .forEach((value) => unique.add(value));
  return Array.from(unique.values());
}

function AdminPanelContent() {
  const { userData, teamTimeOverride } = useAuth();
  const [savingDashboard, setSavingDashboard] = useState(false);
  const [ownerAllowed, setOwnerAllowed] = useState(false);
  const [ownerLoading, setOwnerLoading] = useState(true);
  const [lookupValue, setLookupValue] = useState("");
  const [lookupMode, setLookupMode] = useState<"uid" | "email">("uid");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [managedUser, setManagedUser] = useState<OwnerManagedUser | null>(null);
  const [ownerDraftName, setOwnerDraftName] = useState("");
  const [ownerSaving, setOwnerSaving] = useState(false);
  const [timeInput, setTimeInput] = useState("");
  const [timeSaving, setTimeSaving] = useState(false);
  const [scoutingLookupId, setScoutingLookupId] = useState("");
  const [scoutingLoading, setScoutingLoading] = useState(false);
  const [scoutingSaving, setScoutingSaving] = useState(false);
  const [scoutingDraft, setScoutingDraft] = useState<ScoutingEditDraft | null>(null);
  const [bulkIdsInput, setBulkIdsInput] = useState("");
  const [bulkSetPractice, setBulkSetPractice] = useState(false);
  const [bulkPracticeValue, setBulkPracticeValue] = useState(false);
  const [bulkSetEvent, setBulkSetEvent] = useState(false);
  const [bulkEventKey, setBulkEventKey] = useState("");
  const [bulkEventName, setBulkEventName] = useState("");
  const [bulkSetMatch, setBulkSetMatch] = useState(false);
  const [bulkMatchType, setBulkMatchType] = useState<"practice" | "qualification" | "finals">("qualification");
  const [bulkMatchNumber, setBulkMatchNumber] = useState("");
  const [bulkSetTeam, setBulkSetTeam] = useState(false);
  const [bulkTeamNumber, setBulkTeamNumber] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const dashboardOptions = [
    { label: "Match Scout", value: "/match-scout-dashboard" },
    { label: "Pit Scout", value: "/pit-scout-dashboard" },
    { label: "Pit Team", value: "/pit-team-dashboard" },
    { label: "Drive Team", value: "/drive-team-dashboard" },
    { label: "Lead Scout", value: "/lead-scout-dashboard" },
    { label: "Lead Strategist", value: "/lead-strategist-dashboard" },
    { label: "Media", value: "/media-dashboard" },
    { label: "Judge Awards", value: "/judge-awards-dashboard" },
    { label: "Team Coach", value: "/team-coach-dashboard" },
  ];

  useEffect(() => {
    async function loadOwnerAccess() {
      if (!userData?.uid) {
        setOwnerAllowed(false);
        setOwnerLoading(false);
        return;
      }
      try {
        const response = await fetch("/api/owner/release-access", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uid: userData.uid, email: userData.email || "" }),
        });
        const payload = (await response.json()) as { allowed?: boolean };
        setOwnerAllowed(Boolean(payload.allowed));
      } catch {
        setOwnerAllowed(false);
      } finally {
        setOwnerLoading(false);
      }
    }
    void loadOwnerAccess();
  }, [userData?.uid, userData?.email]);

  useEffect(() => {
    if (!userData?.teamId) return;
    const effectiveNow = getEffectiveNowMs(teamTimeOverride);
    setTimeInput(toLocalDateTimeInputValue(effectiveNow));
  }, [userData?.teamId, teamTimeOverride?.enabled, teamTimeOverride?.offsetMs]);

  async function savePreferredDashboard(nextValue: string) {
    if (!userData?.uid) return;
    setSavingDashboard(true);
    try {
      await setDoc(doc(db, "users", userData.uid), { preferredDashboard: nextValue }, { merge: true });
      alert("Default dashboard updated.");
    } catch (error) {
      console.error("Failed to save preferred dashboard:", error);
      alert("Unable to save default dashboard.");
    } finally {
      setSavingDashboard(false);
    }
  }

  async function lookupUserForOwner() {
    const value = lookupValue.trim();
    if (!ownerAllowed || !value) return;
    setLookupLoading(true);
    try {
      let result: OwnerManagedUser | null = null;
      if (lookupMode === "uid") {
        const snap = await getDoc(doc(db, "users", value));
        if (snap.exists()) {
          const row = snap.data() as Record<string, unknown>;
          result = {
            uid: snap.id,
            email: String(row.email || ""),
            displayName: String(row.displayName || ""),
            role: String(row.role || ""),
            teamId: String(row.teamId || ""),
            emailVerificationExempt: Boolean(row.emailVerificationExempt),
          };
        }
      } else {
        const snap = await getDocs(query(collection(db, "users"), where("email", "==", value)));
        if (!snap.empty) {
          const first = snap.docs[0];
          const row = first.data() as Record<string, unknown>;
          result = {
            uid: first.id,
            email: String(row.email || ""),
            displayName: String(row.displayName || ""),
            role: String(row.role || ""),
            teamId: String(row.teamId || ""),
            emailVerificationExempt: Boolean(row.emailVerificationExempt),
          };
        }
      }
      setManagedUser(result);
      setOwnerDraftName(result?.displayName || "");
      if (!result) alert("No user found for this lookup.");
    } catch (error) {
      console.error("Owner lookup failed:", error);
      alert("Lookup failed.");
    } finally {
      setLookupLoading(false);
    }
  }

  async function saveOwnerUserEdits() {
    if (!ownerAllowed || !managedUser) return;
    const nextDisplayName = ownerDraftName.trim();
    if (!nextDisplayName) {
      alert("Display name cannot be empty.");
      return;
    }
    setOwnerSaving(true);
    try {
      await updateDoc(doc(db, "users", managedUser.uid), {
        displayName: nextDisplayName,
        emailVerificationExempt: Boolean(managedUser.emailVerificationExempt),
        updatedAt: Date.now(),
      });
      setManagedUser((prev) => (prev ? { ...prev, displayName: nextDisplayName } : prev));
      alert("Owner update saved.");
    } catch (error) {
      console.error("Owner update failed:", error);
      alert("Unable to save owner update.");
    } finally {
      setOwnerSaving(false);
    }
  }

  async function saveTeamTimeOverride() {
    if (!userData?.teamId || !userData?.uid) return;
    const nextValue = timeInput.trim();
    if (!nextValue) {
      alert("Pick a date/time first.");
      return;
    }
    const targetMs = new Date(nextValue).getTime();
    if (!Number.isFinite(targetMs)) {
      alert("Invalid date/time.");
      return;
    }
    const offsetMs = targetMs - Date.now();
    setTimeSaving(true);
    try {
      await setDoc(
        doc(db, "teams", userData.teamId),
        {
          timeOverride: {
            enabled: true,
            offsetMs,
            updatedAt: Date.now(),
            updatedBy: userData.uid,
          },
        },
        { merge: true }
      );
      alert("Simulated date/time updated.");
    } catch (error) {
      console.error("Failed to save time override:", error);
      alert("Unable to update simulated time.");
    } finally {
      setTimeSaving(false);
    }
  }

  async function clearTeamTimeOverride() {
    if (!userData?.teamId || !userData?.uid) return;
    setTimeSaving(true);
    try {
      await setDoc(
        doc(db, "teams", userData.teamId),
        {
          timeOverride: {
            enabled: false,
            offsetMs: 0,
            updatedAt: Date.now(),
            updatedBy: userData.uid,
          },
        },
        { merge: true }
      );
      alert("Simulated time disabled.");
    } catch (error) {
      console.error("Failed to clear time override:", error);
      alert("Unable to disable simulated time.");
    } finally {
      setTimeSaving(false);
    }
  }

  const canEditScouting = Boolean(userData?.isTeamAdmin) || ownerAllowed;
  const scoutingEventOptions = (() => {
    const combined = [...getEventsForGame("REBUILT"), ...getEventsForGame("REEFSCAPE")];
    const byId = new Map<string, { id: string; name: string }>();
    combined.forEach((event) => {
      const id = String(event.id || "").trim();
      if (!id || byId.has(id)) return;
      byId.set(id, { id, name: event.name });
    });
    if (scoutingDraft?.eventKey && !byId.has(scoutingDraft.eventKey)) {
      byId.set(scoutingDraft.eventKey, { id: scoutingDraft.eventKey, name: scoutingDraft.eventName || scoutingDraft.eventKey });
    }
    return Array.from(byId.values());
  })();
  const bulkIds = parseBulkIds(bulkIdsInput);

  async function loadScoutingDoc() {
    const id = scoutingLookupId.trim();
    if (!id || !canEditScouting) return;
    setScoutingLoading(true);
    try {
      const snap = await getDoc(doc(db, "scouting", id));
      if (!snap.exists()) {
        setScoutingDraft(null);
        alert("No scouting document found for that ID.");
        return;
      }
      const row = snap.data() as Record<string, unknown>;
      const matchId = String(row.matchId || "");
      const rawMatchType = String(row.matchType || "").trim();
      const matchType = rawMatchType ? coerceMatchType(rawMatchType) : matchTypeFromId(matchId);
      const matchNumber = String(row.matchNumber || parseMatchNumber(matchId) || "");
      const teamNumber = String(row.teamNumber || "").trim();
      const eventKey = String(row.eventKey || "").trim() || "app-testing";
      const eventName = String(row.eventName || "").trim();
      const isPracticeScouting =
        Boolean(row.isPracticeScouting) || Boolean(row.practiceMode) || Boolean(row.practiceSessionId);
      const game = String(row.game || "REBUILT").toUpperCase() === "REEFSCAPE" ? "REEFSCAPE" : "REBUILT";
      setScoutingDraft({
        id: snap.id,
        game,
        eventKey,
        eventName,
        matchType: matchType || matchTypeFromId(matchId),
        matchNumber,
        teamNumber,
        isPracticeScouting,
        practiceMode: typeof row.practiceMode === "string" ? row.practiceMode : undefined,
        practiceSessionId: typeof row.practiceSessionId === "string" ? row.practiceSessionId : undefined,
        isLivePracticeScouting: Boolean(row.isLivePracticeScouting),
      });
    } catch (error) {
      console.error("Failed to load scouting doc:", error);
      alert("Failed to load scouting document.");
    } finally {
      setScoutingLoading(false);
    }
  }

  async function saveScoutingEdits() {
    if (!scoutingDraft || !canEditScouting) return;
    const cleanedEventKey = String(scoutingDraft.eventKey || "").trim().toLowerCase();
    const cleanedMatchNumber = parseMatchNumber(scoutingDraft.matchNumber);
    if (!cleanedEventKey) {
      alert("Event key cannot be empty.");
      return;
    }
    if (!cleanedMatchNumber) {
      alert("Match number cannot be empty.");
      return;
    }
    const cleanedTeamNumber = parseTeamNumber(scoutingDraft.teamNumber);
    if (!cleanedTeamNumber) {
      alert("Team number cannot be empty.");
      return;
    }
    const matchType = scoutingDraft.matchType || "qualification";
    const matchPrefix = matchType === "practice" ? "p" : matchType === "finals" ? "f" : "q";
    const matchId = `${matchPrefix}${cleanedMatchNumber}`;

    const knownEvent = scoutingEventOptions.find((event) => event.id === cleanedEventKey);
    const eventName = String(scoutingDraft.eventName || knownEvent?.name || cleanedEventKey).trim();

    const updatePayload: Record<string, unknown> = {
      eventKey: cleanedEventKey,
      eventName,
      matchType,
      matchNumber: cleanedMatchNumber,
      teamNumber: cleanedTeamNumber,
      matchId,
      isPracticeScouting: Boolean(scoutingDraft.isPracticeScouting),
    };

    if (!scoutingDraft.isPracticeScouting) {
      updatePayload.practiceMode = "";
      updatePayload.practiceSessionId = "";
      updatePayload.isLivePracticeScouting = false;
    }

    setScoutingSaving(true);
    try {
      await updateDoc(doc(db, "scouting", scoutingDraft.id), updatePayload);
      setScoutingDraft((prev) =>
        prev
          ? {
              ...prev,
              eventKey: cleanedEventKey,
              eventName,
              matchNumber: cleanedMatchNumber,
              matchType,
              teamNumber: cleanedTeamNumber,
            }
          : prev
      );
      alert("Scouting entry updated.");
    } catch (error) {
      console.error("Failed to update scouting entry:", error);
      alert("Unable to update scouting entry.");
    } finally {
      setScoutingSaving(false);
    }
  }

  async function runBulkUpdate() {
    if (!canEditScouting) return;
    const ids = bulkIds;
    if (ids.length === 0) {
      alert("Paste at least one scouting document ID.");
      return;
    }
    const updatePayload: Record<string, unknown> = {};

    if (bulkSetEvent) {
      const cleanedEventKey = String(bulkEventKey || "").trim().toLowerCase();
      if (!cleanedEventKey) {
        alert("Event key is required for bulk event updates.");
        return;
      }
      const knownEvent = scoutingEventOptions.find((event) => event.id === cleanedEventKey);
      const eventName = String(bulkEventName || knownEvent?.name || cleanedEventKey).trim();
      updatePayload.eventKey = cleanedEventKey;
      updatePayload.eventName = eventName;
    }

    if (bulkSetMatch) {
      const cleanedMatchNumber = parseMatchNumber(bulkMatchNumber);
      if (!cleanedMatchNumber) {
        alert("Match number is required for bulk match updates.");
        return;
      }
      const matchType = coerceMatchType(bulkMatchType);
      const prefix = matchType === "practice" ? "p" : matchType === "finals" ? "f" : "q";
      updatePayload.matchType = matchType;
      updatePayload.matchNumber = cleanedMatchNumber;
      updatePayload.matchId = `${prefix}${cleanedMatchNumber}`;
    }

    if (bulkSetTeam) {
      const cleanedTeamNumber = parseTeamNumber(bulkTeamNumber);
      if (!cleanedTeamNumber) {
        alert("Team number is required for bulk team updates.");
        return;
      }
      updatePayload.teamNumber = cleanedTeamNumber;
    }

    if (bulkSetPractice) {
      updatePayload.isPracticeScouting = Boolean(bulkPracticeValue);
      if (!bulkPracticeValue) {
        updatePayload.practiceMode = "";
        updatePayload.practiceSessionId = "";
        updatePayload.isLivePracticeScouting = false;
      }
    }

    if (Object.keys(updatePayload).length === 0) {
      alert("Select at least one field to update.");
      return;
    }

    const ok = window.confirm(`Apply updates to ${ids.length} scouting entries?`);
    if (!ok) return;

    setBulkSaving(true);
    try {
      const results = await Promise.allSettled(
        ids.map((id) => updateDoc(doc(db, "scouting", id), updatePayload))
      );
      const successCount = results.filter((result) => result.status === "fulfilled").length;
      const failCount = results.length - successCount;
      if (failCount > 0) {
        console.warn("Bulk update failures:", results);
      }
      alert(`Bulk update complete. Updated ${successCount}/${ids.length} entries.`);
    } catch (error) {
      console.error("Bulk update failed:", error);
      alert("Bulk update failed.");
    } finally {
      setBulkSaving(false);
    }
  }

  if (ownerLoading) {
    return (
      <div className="flex h-screen bg-gray-50">
        <Sidebar />
        <div className="flex-1 overflow-auto p-8">
          <div className="max-w-xl bg-white rounded-xl shadow-md p-6">
            <h1 className="text-2xl font-bold mb-2" style={{ color: "var(--primary-color)" }}>Admin Panel</h1>
            <p className="text-gray-600">Checking access...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!userData?.isTeamAdmin && !ownerAllowed) {
    return (
      <div className="flex h-screen bg-gray-50">
        <Sidebar />
        <div className="flex-1 overflow-auto p-8">
          <div className="max-w-xl bg-white rounded-xl shadow-md p-6">
            <h1 className="text-2xl font-bold mb-2" style={{ color: "var(--primary-color)" }}>Admin Panel</h1>
            <p className="text-gray-600">Only team admins can access this panel.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      <div className="flex-1 overflow-auto p-8">
        <div className="max-w-3xl">
          <h1 className="text-3xl font-bold mb-2" style={{ color: "var(--primary-color)" }}>Admin Panel</h1>
          <p className="text-gray-600 mb-8">Search Firestore IDs for scouting and practice session records.</p>

          <div className="bg-white rounded-xl shadow-md p-6 border mb-4">
            <h2 className="text-xl font-semibold mb-2">Default Dashboard</h2>
            <p className="text-sm text-gray-600 mb-3">Set where your Dashboard button sends you by default.</p>
            <select
              className="w-full max-w-md border rounded p-2"
              value={String(userData?.preferredDashboard || "")}
              onChange={(event) => void savePreferredDashboard(event.target.value)}
              disabled={savingDashboard}
            >
              <option value="">Role-Based Default</option>
              {dashboardOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="bg-white rounded-xl shadow-md p-6 border mb-4">
            <h2 className="text-xl font-semibold mb-2">Simulated Date / Time</h2>
            <p className="text-sm text-gray-600 mb-3">
              Use this to test event windows when no competitions are currently live.
            </p>
            <div className="grid gap-3 max-w-md">
              <input
                type="datetime-local"
                className="w-full border rounded p-2"
                value={timeInput}
                onChange={(event) => setTimeInput(event.target.value)}
              />
              <p className="text-xs text-gray-500">
                {teamTimeOverride?.enabled ? "Override enabled" : "Override disabled"} · Effective now:{" "}
                {new Date(getEffectiveNowMs(teamTimeOverride)).toLocaleString()}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void saveTeamTimeOverride()}
                  disabled={timeSaving}
                  className="px-4 py-2 rounded text-white font-semibold disabled:opacity-60"
                  style={{ backgroundColor: "var(--primary-color)" }}
                >
                  Apply Simulated Time
                </button>
                <button
                  type="button"
                  onClick={() => void clearTeamTimeOverride()}
                  disabled={timeSaving}
                  className="px-4 py-2 rounded border border-gray-300 text-gray-700 disabled:opacity-60"
                >
                  Use Real Time
                </button>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-md p-6 border mb-4">
            <h2 className="text-xl font-semibold mb-2">Scouting Entry Editor</h2>
            <p className="text-sm text-gray-600 mb-4">
              Update practice flag, event assignment, or match number for a scouting document.
            </p>
            {!canEditScouting && (
              <p className="text-sm text-gray-500">Only team admins can edit scouting entries.</p>
            )}
            {canEditScouting && (
              <>
                <div className="grid md:grid-cols-[1fr_auto] gap-2 mb-3">
                  <input
                    className="border rounded p-2"
                    value={scoutingLookupId}
                    onChange={(event) => setScoutingLookupId(event.target.value)}
                    placeholder="Paste scouting document ID"
                  />
                  <button
                    type="button"
                    onClick={() => void loadScoutingDoc()}
                    disabled={scoutingLoading}
                    className="px-4 py-2 rounded text-white font-semibold disabled:opacity-60"
                    style={{ backgroundColor: "var(--primary-color)" }}
                  >
                    {scoutingLoading ? "Loading..." : "Load"}
                  </button>
                </div>

                {scoutingDraft && (
                  <div className="space-y-4 border rounded p-4">
                    <p className="text-xs text-gray-500">Loaded ID: <span className="font-mono text-gray-700">{scoutingDraft.id}</span></p>
                    <p className="text-xs text-gray-500">Game: <span className="font-semibold text-gray-700">{scoutingDraft.game}</span></p>

                    <label className="flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={scoutingDraft.isPracticeScouting}
                        onChange={(event) =>
                          setScoutingDraft((prev) => (prev ? { ...prev, isPracticeScouting: event.target.checked } : prev))
                        }
                      />
                      Practice scouted entry
                    </label>
                    {(scoutingDraft.practiceMode || scoutingDraft.practiceSessionId) && (
                      <p className="text-xs text-gray-500">
                        Practice mode: {scoutingDraft.practiceMode || "-"} · Session: {scoutingDraft.practiceSessionId || "-"}
                      </p>
                    )}

                    <div className="grid sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Event Key</label>
                        <input
                          list="scouting-event-options"
                          className="w-full border rounded p-2"
                          value={scoutingDraft.eventKey}
                          onChange={(event) =>
                            setScoutingDraft((prev) => (prev ? { ...prev, eventKey: event.target.value } : prev))
                          }
                          placeholder="e.g. 2026arli"
                        />
                        <datalist id="scouting-event-options">
                          {scoutingEventOptions.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.name}
                            </option>
                          ))}
                        </datalist>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Event Name</label>
                        <input
                          className="w-full border rounded p-2"
                          value={scoutingDraft.eventName}
                          onChange={(event) =>
                            setScoutingDraft((prev) => (prev ? { ...prev, eventName: event.target.value } : prev))
                          }
                          placeholder="Optional display name"
                        />
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-4 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Match Type</label>
                        <select
                          className="w-full border rounded p-2"
                          value={scoutingDraft.matchType}
                          onChange={(event) =>
                            setScoutingDraft((prev) =>
                              prev ? { ...prev, matchType: coerceMatchType(event.target.value) } : prev
                            )
                          }
                        >
                          <option value="practice">Practice</option>
                          <option value="qualification">Qualification</option>
                          <option value="finals">Finals</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Match Number</label>
                        <input
                          className="w-full border rounded p-2"
                          value={scoutingDraft.matchNumber}
                          onChange={(event) =>
                            setScoutingDraft((prev) => (prev ? { ...prev, matchNumber: event.target.value } : prev))
                          }
                          placeholder="e.g. 5"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Team Number</label>
                        <input
                          className="w-full border rounded p-2"
                          value={scoutingDraft.teamNumber}
                          onChange={(event) =>
                            setScoutingDraft((prev) => (prev ? { ...prev, teamNumber: event.target.value } : prev))
                          }
                          placeholder="e.g. 3468"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Match ID Preview</label>
                        <div className="w-full border rounded p-2 bg-gray-50 text-sm text-gray-700">
                          {(() => {
                            const number = parseMatchNumber(scoutingDraft.matchNumber);
                            if (!number) return "-";
                            const prefix = scoutingDraft.matchType === "practice" ? "p" : scoutingDraft.matchType === "finals" ? "f" : "q";
                            return `${prefix}${number}`;
                          })()}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => void saveScoutingEdits()}
                      disabled={scoutingSaving}
                      className="px-4 py-2 rounded text-white font-semibold disabled:opacity-60"
                      style={{ backgroundColor: "var(--primary-color)" }}
                    >
                      {scoutingSaving ? "Saving..." : "Save Scouting Changes"}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="bg-white rounded-xl shadow-md p-6 border mb-4">
            <h2 className="text-xl font-semibold mb-2">Bulk Scouting Editor</h2>
            <p className="text-sm text-gray-600 mb-4">
              Paste multiple scouting document IDs and apply updates in one batch.
            </p>
            {!canEditScouting && (
              <p className="text-sm text-gray-500">Only team admins can run bulk edits.</p>
            )}
            {canEditScouting && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Scouting Document IDs</label>
                  <textarea
                    className="w-full border rounded p-2 h-28"
                    value={bulkIdsInput}
                    onChange={(event) => setBulkIdsInput(event.target.value)}
                    placeholder="One ID per line or separated by commas"
                  />
                  <p className="text-xs text-gray-500 mt-1">{bulkIds.length} IDs detected.</p>
                </div>

                <div className="grid md:grid-cols-3 gap-3">
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={bulkSetPractice}
                      onChange={(event) => setBulkSetPractice(event.target.checked)}
                    />
                    Update practice flag
                  </label>
                  {bulkSetPractice && (
                    <select
                      className="border rounded p-2"
                      value={bulkPracticeValue ? "practice" : "match"}
                      onChange={(event) => setBulkPracticeValue(event.target.value === "practice")}
                    >
                      <option value="practice">Set to Practice</option>
                      <option value="match">Set to Match</option>
                    </select>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={bulkSetEvent}
                      onChange={(event) => setBulkSetEvent(event.target.checked)}
                    />
                    Update event assignment
                  </label>
                  {bulkSetEvent && (
                    <div className="grid sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Event Key</label>
                        <input
                          list="bulk-event-options"
                          className="w-full border rounded p-2"
                          value={bulkEventKey}
                          onChange={(event) => setBulkEventKey(event.target.value)}
                          placeholder="e.g. 2026arli"
                        />
                        <datalist id="bulk-event-options">
                          {scoutingEventOptions.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.name}
                            </option>
                          ))}
                        </datalist>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Event Name (optional)</label>
                        <input
                          className="w-full border rounded p-2"
                          value={bulkEventName}
                          onChange={(event) => setBulkEventName(event.target.value)}
                          placeholder="Display name override"
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={bulkSetMatch}
                      onChange={(event) => setBulkSetMatch(event.target.checked)}
                    />
                    Update match assignment
                  </label>
                  {bulkSetMatch && (
                    <div className="grid sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Match Type</label>
                        <select
                          className="w-full border rounded p-2"
                          value={bulkMatchType}
                          onChange={(event) => setBulkMatchType(coerceMatchType(event.target.value))}
                        >
                          <option value="practice">Practice</option>
                          <option value="qualification">Qualification</option>
                          <option value="finals">Finals</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Match Number</label>
                        <input
                          className="w-full border rounded p-2"
                          value={bulkMatchNumber}
                          onChange={(event) => setBulkMatchNumber(event.target.value)}
                          placeholder="e.g. 7"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Match ID Preview</label>
                        <div className="w-full border rounded p-2 bg-gray-50 text-sm text-gray-700">
                          {(() => {
                            const number = parseMatchNumber(bulkMatchNumber);
                            if (!number) return "-";
                            const prefix = bulkMatchType === "practice" ? "p" : bulkMatchType === "finals" ? "f" : "q";
                            return `${prefix}${number}`;
                          })()}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={bulkSetTeam}
                      onChange={(event) => setBulkSetTeam(event.target.checked)}
                    />
                    Update team number
                  </label>
                  {bulkSetTeam && (
                    <div className="max-w-xs">
                      <label className="block text-sm font-medium text-gray-700 mb-1">Team Number</label>
                      <input
                        className="w-full border rounded p-2"
                        value={bulkTeamNumber}
                        onChange={(event) => setBulkTeamNumber(event.target.value)}
                        placeholder="e.g. 3468"
                      />
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => void runBulkUpdate()}
                  disabled={bulkSaving}
                  className="px-4 py-2 rounded text-white font-semibold disabled:opacity-60"
                  style={{ backgroundColor: "var(--primary-color)" }}
                >
                  {bulkSaving ? "Applying..." : "Apply Bulk Update"}
                </button>
              </div>
            )}
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Link href="/admin/match-scout-ids" className="bg-white rounded-xl shadow-md p-6 border hover:bg-gray-50">
              <h2 className="text-xl font-semibold mb-2">Match Scout IDs</h2>
              <p className="text-sm text-gray-600">Search scouting document IDs for official match scouting rows.</p>
            </Link>
            <Link href="/admin/practice-session-ids" className="bg-white rounded-xl shadow-md p-6 border hover:bg-gray-50">
              <h2 className="text-xl font-semibold mb-2">Practice Session IDs</h2>
              <p className="text-sm text-gray-600">Search practice session document IDs for team members.</p>
            </Link>
          </div>

          {!ownerLoading && ownerAllowed && (
            <div className="bg-white rounded-xl shadow-md p-6 border mt-6">
              <h2 className="text-xl font-semibold mb-2">Owner User Management</h2>
              <p className="text-sm text-gray-600 mb-4">Lookup by UID/email, rename user, and manage email verification exemption.</p>

              <div className="grid md:grid-cols-[120px_1fr_auto] gap-2 mb-4">
                <select
                  className="border rounded p-2"
                  value={lookupMode}
                  onChange={(event) => setLookupMode(event.target.value === "email" ? "email" : "uid")}
                >
                  <option value="uid">UID</option>
                  <option value="email">Email</option>
                </select>
                <input
                  className="border rounded p-2"
                  value={lookupValue}
                  onChange={(event) => setLookupValue(event.target.value)}
                  placeholder={lookupMode === "uid" ? "Paste user UID" : "user@email.com"}
                />
                <button
                  type="button"
                  onClick={() => void lookupUserForOwner()}
                  disabled={lookupLoading}
                  className="px-4 py-2 rounded text-white font-semibold disabled:opacity-60"
                  style={{ backgroundColor: "var(--primary-color)" }}
                >
                  {lookupLoading ? "Searching..." : "Lookup"}
                </button>
              </div>

              {managedUser && (
                <div className="space-y-3 border rounded p-4">
                  <p className="text-sm text-gray-600">UID: <span className="font-mono text-gray-900">{managedUser.uid}</span></p>
                  <p className="text-sm text-gray-600">Email: <span className="text-gray-900">{managedUser.email || "-"}</span></p>
                  <p className="text-sm text-gray-600">Team: <span className="text-gray-900">{managedUser.teamId || "-"}</span></p>
                  <p className="text-sm text-gray-600">Role: <span className="text-gray-900">{managedUser.role || "-"}</span></p>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Display Name</label>
                    <input
                      className="w-full border rounded p-2"
                      value={ownerDraftName}
                      onChange={(event) => setOwnerDraftName(event.target.value)}
                    />
                  </div>

                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={Boolean(managedUser.emailVerificationExempt)}
                      onChange={(event) =>
                        setManagedUser((prev) =>
                          prev ? { ...prev, emailVerificationExempt: event.target.checked } : prev
                        )
                      }
                    />
                    Email verification exempt (personally verified by owner)
                  </label>

                  <button
                    type="button"
                    onClick={() => void saveOwnerUserEdits()}
                    disabled={ownerSaving}
                    className="px-4 py-2 rounded text-white font-semibold disabled:opacity-60"
                    style={{ backgroundColor: "var(--primary-color)" }}
                  >
                    {ownerSaving ? "Saving..." : "Save Owner Changes"}
                  </button>
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

export default function AdminPanelPage() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["coach", "scout"]}>
      <AdminPanelContent />
    </ProtectedRoute>
  );
}



"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";
import { db } from "@/app/firebase";
import { getEffectiveNowMs, toLocalDateTimeInputValue } from "@/app/utils/teamTime";
import {
  entryMatchesAnalyticsFilters,
  getEventOptionsForEntries,
  getEventsForGame,
  isLeadScoutingEntry,
  isPracticeScoutedEntry,
  type AnalyticsGame,
} from "@/app/utils/analyticsEvents";

type OwnerManagedUser = {
  uid: string;
  email: string;
  displayName: string;
  teamId?: string;
  role?: string;
  emailVerificationExempt?: boolean;
};

type FormTypeId =
  | "match-scout"
  | "lead-scout"
  | "pit-scout"
  | "team-strategy"
  | "match-strategy"
  | "drive-reflection";

type FormTypeOption = {
  id: FormTypeId;
  label: string;
  collections: string[];
  supportsPracticeToggle?: boolean;
};

type FormEditorEntry = {
  id: string;
  collection: string;
  data: Record<string, unknown>;
};

const FORM_TYPES: FormTypeOption[] = [
  { id: "match-scout", label: "Match Scout Form", collections: ["scouting"], supportsPracticeToggle: true },
  { id: "lead-scout", label: "Lead Scout Form", collections: ["leadScouting", "scouting"] },
  { id: "pit-scout", label: "Pit Scout Form", collections: ["pitScouting"] },
  { id: "team-strategy", label: "Team Strategy Form", collections: ["strategyScouting"] },
  { id: "match-strategy", label: "Match Strategy Form", collections: ["matchStrategyPlans"] },
  { id: "drive-reflection", label: "Drive Reflection Form", collections: ["driveScouting"] },
];

function entrySortTime(entry: Record<string, unknown>): number {
  const raw = Number(entry.submittedAt ?? entry.createdAt ?? entry.timestamp ?? 0);
  return Number.isFinite(raw) ? raw : 0;
}

function entryMatchLabel(entry: Record<string, unknown>): string {
  return String(
    entry.matchLabel || entry.matchId || entry.matchKey || entry.matchNumber || ""
  )
    .trim();
}

function entryTeamLabel(entry: Record<string, unknown>): string {
  const value = String(entry.teamNumber || "").trim();
  return value ? `Team ${value}` : "";
}

function entryScoutLabel(entry: Record<string, unknown>): string {
  const value = String(entry.scoutName || "").trim();
  return value ? `Scout: ${value}` : "";
}

function entryRobotTeams(entry: Record<string, unknown>): string {
  const robots = Array.isArray(entry.robots) ? entry.robots : [];
  const teams = robots
    .map((robot) => (robot && typeof robot === "object" ? String((robot as { teamNumber?: string }).teamNumber || "").trim() : ""))
    .filter(Boolean);
  return teams.length > 0 ? teams.join(", ") : "";
}

function buildEntrySummary(entry: Record<string, unknown>, formType: FormTypeId) {
  const matchLabel = entryMatchLabel(entry);
  const teamLabel = entryTeamLabel(entry);
  const scoutLabel = entryScoutLabel(entry);
  if (formType === "match-scout") {
    return {
      title: `${matchLabel || "Match"}${teamLabel ? ` - ${teamLabel}` : ""}`,
      subtitle: scoutLabel,
    };
  }
  if (formType === "lead-scout") {
    const alliance = String(entry.alliance || "").toUpperCase();
    return {
      title: `${matchLabel || "Lead Match"}${alliance ? ` - ${alliance}` : ""}`,
      subtitle: scoutLabel,
    };
  }
  if (formType === "pit-scout" || formType === "team-strategy") {
    return {
      title: teamLabel || "Team Entry",
      subtitle: scoutLabel,
    };
  }
  if (formType === "match-strategy" || formType === "drive-reflection") {
    const teams = entryRobotTeams(entry);
    return {
      title: matchLabel || "Match Plan",
      subtitle: teams ? `Teams: ${teams}` : scoutLabel,
    };
  }
  return { title: matchLabel || teamLabel || "Entry", subtitle: scoutLabel };
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
  const [formEditorOpen, setFormEditorOpen] = useState(false);
  const [selectedFormType, setSelectedFormType] = useState<FormTypeOption | null>(null);
  const [formGame, setFormGame] = useState<AnalyticsGame>("REBUILT");
  const [formEvent, setFormEvent] = useState("all");
  const [formPracticeOnly, setFormPracticeOnly] = useState(false);
  const [formEntriesRaw, setFormEntriesRaw] = useState<FormEditorEntry[]>([]);
  const [formEntriesLoading, setFormEntriesLoading] = useState(false);
  const [selectedFormEntry, setSelectedFormEntry] = useState<FormEditorEntry | null>(null);
  const [entryDraftJson, setEntryDraftJson] = useState("");
  const [entrySaving, setEntrySaving] = useState(false);
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
  const formEventOptions = useMemo(() => {
    const baseEntries = formEntriesRaw.map((row) => row.data as { eventKey?: string; eventName?: string; game?: string });
    return [{ id: "all", name: "All Events" }, ...getEventOptionsForEntries(baseEntries, formGame)];
  }, [formEntriesRaw, formGame]);

  useEffect(() => {
    if (!selectedFormType?.supportsPracticeToggle) {
      setFormPracticeOnly(false);
    }
  }, [selectedFormType]);

  useEffect(() => {
    if (formEvent !== "all" && !formEventOptions.some((option) => option.id === formEvent)) {
      setFormEvent("all");
    }
  }, [formEventOptions, formEvent]);

  useEffect(() => {
    setSelectedFormEntry(null);
    setEntryDraftJson("");
  }, [selectedFormType, formGame, formEvent, formPracticeOnly]);

  useEffect(() => {
    if (!formEditorOpen || !userData?.teamId) {
      setFormEntriesRaw([]);
      return;
    }
    const formType = selectedFormType;
    if (!formType) {
      setFormEntriesRaw([]);
      return;
    }
    let isActive = true;
    async function loadEntries(activeFormType: FormTypeOption) {
      setFormEntriesLoading(true);
      try {
        const rows: FormEditorEntry[] = [];
        const teamIdFilter = String(userData?.teamId || "").trim();
        const numericTeamId = Number(teamIdFilter);
        const includeNumericTeamId = Number.isFinite(numericTeamId) && String(numericTeamId) !== teamIdFilter;
        const seenIds = new Set<string>();
        await Promise.all(
          activeFormType.collections.map(async (collectionName) => {
            const baseRef = collection(db, collectionName);
            const snapshots = [];
            if (teamIdFilter) {
              snapshots.push(await getDocs(query(baseRef, where("teamId", "==", teamIdFilter))));
              if (includeNumericTeamId) {
                snapshots.push(await getDocs(query(baseRef, where("teamId", "==", numericTeamId))));
              }
            } else {
              snapshots.push(await getDocs(baseRef));
            }
            if (collectionName === "leadScouting" && formEvent !== "all") {
              try {
                snapshots.push(await getDocs(query(baseRef, where("eventKey", "==", formEvent))));
              } catch {
                // Ignore fallback errors (likely permission-related).
              }
            }
            snapshots.forEach((snap) => {
              snap.docs.forEach((docSnap) => {
                if (seenIds.has(docSnap.id)) return;
                const data = docSnap.data() as Record<string, unknown>;
                const teamId = String(data.teamId || "").trim();
                if (userData?.teamId && teamId && teamId !== String(userData.teamId)) return;
                if (activeFormType.id === "lead-scout") {
                  if (!isLeadScoutingEntry(data) && collectionName !== "leadScouting") return;
                } else if (collectionName === "scouting" && isLeadScoutingEntry(data)) {
                  return;
                }
                seenIds.add(docSnap.id);
                rows.push({ id: docSnap.id, collection: collectionName, data });
              });
            });
          })
        );
        if (isActive) setFormEntriesRaw(rows);
      } catch (error) {
        console.error("Failed to load form entries:", error);
        if (isActive) setFormEntriesRaw([]);
      } finally {
        if (isActive) setFormEntriesLoading(false);
      }
    }
    void loadEntries(formType);
    return () => {
      isActive = false;
    };
  }, [formEditorOpen, selectedFormType, userData?.teamId, formEvent]);

  useEffect(() => {
    if (!selectedFormEntry) {
      setEntryDraftJson("");
      return;
    }
    setEntryDraftJson(JSON.stringify(selectedFormEntry.data, null, 2));
  }, [selectedFormEntry]);

  const filteredFormEntries = useMemo(() => {
    if (!selectedFormType) return [];
    const eventOptions = getEventsForGame(formGame);
    return formEntriesRaw
      .filter((row) => {
        const entry = row.data;
        const normalizedEntry = {
          ...entry,
          game: (entry.game || formGame) as AnalyticsGame,
          submittedAt: entry.submittedAt || entry.timestamp || entry.createdAt || 0,
          timestamp: entry.timestamp || entry.submittedAt || entry.createdAt || 0,
        } as Record<string, unknown>;
        const includeLead = selectedFormType.id === "lead-scout";
        if (selectedFormType.id === "lead-scout" && !isLeadScoutingEntry(entry)) return false;
        if (!entryMatchesAnalyticsFilters(normalizedEntry, formGame, formEvent, eventOptions, { includeLead })) {
          return false;
        }
        if (selectedFormType.id === "match-scout") {
          const isPractice = isPracticeScoutedEntry(entry as { isPracticeScouting?: boolean; practiceMode?: string; practiceSessionId?: string });
          if (formPracticeOnly && !isPractice) return false;
          if (!formPracticeOnly && isPractice) return false;
        }
        return true;
      })
      .sort((a, b) => entrySortTime(b.data) - entrySortTime(a.data));
  }, [formEntriesRaw, selectedFormType, formGame, formEvent, formPracticeOnly]);

  async function saveFormEdits() {
    if (!selectedFormEntry || !canEditScouting) return;
    let payload: Record<string, unknown>;
    try {
      const parsed = JSON.parse(entryDraftJson || "");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        alert("Edited form must be a JSON object.");
        return;
      }
      payload = parsed as Record<string, unknown>;
    } catch (error) {
      console.error("Invalid JSON payload:", error);
      alert("Invalid JSON. Please fix formatting before saving.");
      return;
    }

    setEntrySaving(true);
    try {
      await setDoc(doc(db, selectedFormEntry.collection, selectedFormEntry.id), payload, { merge: true });
      setFormEntriesRaw((prev) =>
        prev.map((row) =>
          row.id === selectedFormEntry.id && row.collection === selectedFormEntry.collection
            ? { ...row, data: payload }
            : row
        )
      );
      setSelectedFormEntry((prev) => (prev ? { ...prev, data: payload } : prev));
      alert("Form updated.");
    } catch (error) {
      console.error("Failed to update form:", error);
      alert("Unable to update form entry.");
    } finally {
      setEntrySaving(false);
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
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xl font-semibold">Form Editor</h2>
              <button
                type="button"
                onClick={() => setFormEditorOpen((prev) => !prev)}
                className="px-3 py-1 rounded border border-gray-300 text-sm"
              >
                {formEditorOpen ? "Close" : "Open"}
              </button>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Edit submitted forms by event and game. Changes save back to Firestore.
            </p>
            {!canEditScouting && (
              <p className="text-sm text-gray-500">Only team admins can edit forms.</p>
            )}
            {canEditScouting && formEditorOpen && (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {FORM_TYPES.map((form) => (
                    <button
                      key={form.id}
                      type="button"
                      onClick={() => setSelectedFormType(form)}
                      className={`px-3 py-1 rounded border text-sm ${
                        selectedFormType?.id === form.id
                          ? "text-white"
                          : "bg-white text-gray-700 border-gray-300"
                      }`}
                      style={
                        selectedFormType?.id === form.id
                          ? { backgroundColor: "var(--primary-color)", borderColor: "var(--primary-color)" }
                          : undefined
                      }
                    >
                      {form.label}
                    </button>
                  ))}
                </div>

                {selectedFormType ? (
                  <>
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="text-sm font-medium text-gray-700">Game</label>
                      <select
                        className="border rounded p-2 text-sm"
                        value={formGame}
                        onChange={(event) => setFormGame(event.target.value === "REEFSCAPE" ? "REEFSCAPE" : "REBUILT")}
                      >
                        <option value="REBUILT">REBUILT</option>
                        <option value="REEFSCAPE">REEFSCAPE</option>
                      </select>

                      <label className="text-sm font-medium text-gray-700">Event</label>
                      <select
                        className="border rounded p-2 text-sm min-w-[200px]"
                        value={formEvent}
                        onChange={(event) => setFormEvent(event.target.value)}
                      >
                        {formEventOptions.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {selectedFormType.supportsPracticeToggle && (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-gray-700">Match Scope</span>
                        <button
                          type="button"
                          onClick={() => setFormPracticeOnly(false)}
                          className={`px-3 py-1 rounded border text-sm ${
                            !formPracticeOnly ? "text-white" : "bg-white text-gray-700 border-gray-300"
                          }`}
                          style={
                            !formPracticeOnly
                              ? { backgroundColor: "var(--primary-color)", borderColor: "var(--primary-color)" }
                              : undefined
                          }
                        >
                          Event
                        </button>
                        <button
                          type="button"
                          onClick={() => setFormPracticeOnly(true)}
                          className={`px-3 py-1 rounded border text-sm ${
                            formPracticeOnly ? "text-white" : "bg-white text-gray-700 border-gray-300"
                          }`}
                          style={
                            formPracticeOnly
                              ? { backgroundColor: "var(--primary-color)", borderColor: "var(--primary-color)" }
                              : undefined
                          }
                        >
                          Practice
                        </button>
                      </div>
                    )}

                    <div className="grid md:grid-cols-[1.4fr_2fr] gap-4">
                      <div className="border rounded p-2 bg-gray-50 max-h-[420px] overflow-y-auto">
                        {formEntriesLoading ? (
                          <p className="text-sm text-gray-600 p-2">Loading forms...</p>
                        ) : filteredFormEntries.length === 0 ? (
                          <p className="text-sm text-gray-600 p-2">No forms found for this selection.</p>
                        ) : (
                          <div className="space-y-2">
                            {filteredFormEntries.map((row) => {
                              const summary = buildEntrySummary(row.data, selectedFormType.id);
                              const timeValue = entrySortTime(row.data);
                              const timeLabel = timeValue ? new Date(timeValue).toLocaleString() : "";
                              const isSelected =
                                selectedFormEntry?.id === row.id && selectedFormEntry.collection === row.collection;
                              return (
                                <button
                                  key={`${row.collection}:${row.id}`}
                                  type="button"
                                  onClick={() => setSelectedFormEntry(row)}
                                  className={`w-full text-left rounded border p-2 transition ${
                                    isSelected ? "border-purple-500 bg-purple-50" : "border-gray-200 bg-white hover:bg-gray-50"
                                  }`}
                                >
                                  <div className="font-semibold text-sm">{summary.title}</div>
                                  {summary.subtitle && <div className="text-xs text-gray-600">{summary.subtitle}</div>}
                                  {timeLabel && <div className="text-xs text-gray-500">{timeLabel}</div>}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      <div className="border rounded p-3 bg-white">
                        {selectedFormEntry ? (
                          <div className="space-y-3">
                            <p className="text-xs text-gray-500">
                              Editing ID: <span className="font-mono text-gray-700">{selectedFormEntry.id}</span>
                            </p>
                            <textarea
                              className="w-full border rounded p-2 h-72 font-mono text-xs"
                              value={entryDraftJson}
                              onChange={(event) => setEntryDraftJson(event.target.value)}
                            />
                            <button
                              type="button"
                              onClick={() => void saveFormEdits()}
                              disabled={entrySaving}
                              className="px-4 py-2 rounded text-white font-semibold disabled:opacity-60"
                              style={{ backgroundColor: "var(--primary-color)" }}
                            >
                              {entrySaving ? "Saving..." : "Save Form Changes"}
                            </button>
                          </div>
                        ) : (
                          <p className="text-sm text-gray-600">Select a form entry to edit.</p>
                        )}
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-gray-600">Choose a form to begin editing.</p>
                )}
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



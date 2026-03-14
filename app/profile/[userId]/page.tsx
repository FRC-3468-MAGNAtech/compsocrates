"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { collection, doc, getDoc, getDocFromServer, getDocs, query, where } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import { useAuth } from "@/app/AuthContext";
import { getRoleBadge, getUserRoles } from "@/app/utils/roles";
import { getEventsForGame, isInEventWindow, type AnalyticsGame } from "@/app/utils/analyticsEvents";

type UserProfile = {
  uid: string;
  displayName: string;
  email: string;
  role: string;
  roles?: string[];
  profileVisibility?: "team" | "public" | "private";
  bio?: string;
  teamId?: string;
  photoURL?: string;
};

type TeamDoc = {
  teamName?: string;
  teamNumber?: string;
};

function ProfileContent() {
  const params = useParams<{ userId: string }>();
  const { userData } = useAuth();
  const viewerRoles = getUserRoles({ role: userData?.role, roles: userData?.roles });
  const canViewAccuracy =
    Boolean(userData?.isTeamAdmin) ||
    userData?.role === "coach" ||
    viewerRoles.includes("team-coach") ||
    viewerRoles.includes("lead-scout");
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [teamLabel, setTeamLabel] = useState("No team");
  const [canView, setCanView] = useState(true);
  const [stats, setStats] = useState({
    totalEntries: 0,
    practiceEntries: 0,
    practiceSessions: 0,
    avgAccuracy: 0,
    eventsScouted: 0,
  });
  type BreakdownRow = {
    season: number;
    game: string;
    event: string;
    match: string;
    scoutingType: "Trial" | "Competitive" | "Real Competition";
    difficulty: string;
    count: number;
    accuracyTotal: number;
    accuracyCount: number;
    lastScoutedAt: number;
  };
  const [scoutingBreakdown, setScoutingBreakdown] = useState<
    BreakdownRow[]
  >([]);
  const [sortKey, setSortKey] = useState<
    "lastScoutedAt" | "season" | "game" | "event" | "match" | "scoutingType" | "difficulty" | "accuracy" | "count"
  >("lastScoutedAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!canViewAccuracy && sortKey === "accuracy") {
      setSortKey("lastScoutedAt");
    }
  }, [canViewAccuracy, sortKey]);

  useEffect(() => {
    async function loadProfile() {
      if (!params?.userId) return;
      setLoading(true);
      try {
        const userSnap = await getDocFromServer(doc(db, "users", params.userId));
        if (!userSnap.exists()) {
          setProfile(null);
          return;
        }
        const user = userSnap.data() as UserProfile;
        const sameUser = userData?.uid === params.userId || userData?.uid === user.uid;
        const mergedProfile = sameUser && userData
          ? ({ ...user, ...userData, uid: params.userId } as UserProfile)
          : user;
        setProfile(mergedProfile);
        const visibility = mergedProfile.profileVisibility || "team";
        const sameTeam = Boolean(userData?.teamId && mergedProfile.teamId && userData.teamId === mergedProfile.teamId);
        const visible =
          visibility === "public" ||
          sameUser ||
          (visibility === "team" && sameTeam);
        setCanView(visible);

        if (!visible) return;

        if (mergedProfile.teamId) {
          const teamSnap = await getDoc(doc(db, "teams", mergedProfile.teamId));
          if (teamSnap.exists()) {
            const teamData = teamSnap.data() as TeamDoc;
          setTeamLabel(teamData.teamNumber || teamData.teamName || mergedProfile.teamId);
          } else {
            setTeamLabel(mergedProfile.teamId);
          }
        }

        const [scoutingByNameSnap, scoutingByUidSnap, practiceByNameSnap, practiceByUidSnap] = await Promise.all([
          getDocs(query(collection(db, "scouting"), where("scoutName", "==", mergedProfile.displayName))),
          getDocs(query(collection(db, "scouting"), where("scoutId", "==", params.userId))),
          getDocs(query(collection(db, "practiceSessions"), where("scoutName", "==", mergedProfile.displayName))),
          getDocs(query(collection(db, "practiceSessions"), where("scoutId", "==", params.userId))),
        ]);
        const scoutingDocs = new Map<string, Record<string, unknown>>();
        scoutingByNameSnap.docs.forEach((entryDoc) => {
          scoutingDocs.set(entryDoc.id, entryDoc.data() as Record<string, unknown>);
        });
        scoutingByUidSnap.docs.forEach((entryDoc) => {
          scoutingDocs.set(entryDoc.id, entryDoc.data() as Record<string, unknown>);
        });
        const practiceDocs = new Map<string, Record<string, unknown>>();
        practiceByNameSnap.docs.forEach((entryDoc) => {
          practiceDocs.set(entryDoc.id, entryDoc.data() as Record<string, unknown>);
        });
        practiceByUidSnap.docs.forEach((entryDoc) => {
          practiceDocs.set(entryDoc.id, entryDoc.data() as Record<string, unknown>);
        });

        const eventKeys = new Set<string>();
        const eventsByGame = new Map<AnalyticsGame, Map<string, { startDate?: string; endDate?: string }>>();
        (["REEFSCAPE", "REBUILT"] as AnalyticsGame[]).forEach((game) => {
          const map = new Map<string, { startDate?: string; endDate?: string }>();
          getEventsForGame(game).forEach((event) => {
            map.set(event.id, { startDate: event.startDate, endDate: event.endDate });
          });
          eventsByGame.set(game, map);
        });
        const breakdownMap = new Map<
          string,
          BreakdownRow
        >();
        let practiceEntries = 0;
        scoutingDocs.forEach((entry) => {
          const eventKey = String(entry.eventKey || "");
          const eventSeason = parseInt(eventKey.slice(0, 4), 10);
          const fallbackTimestamp =
            (typeof entry.timestamp === "number" ? entry.timestamp : 0) ||
            (typeof entry.submittedAt === "number" ? entry.submittedAt : 0);
          const fallbackSeason = fallbackTimestamp > 0 ? new Date(fallbackTimestamp).getFullYear() : new Date().getFullYear();
          const season = Number.isFinite(eventSeason) ? eventSeason : fallbackSeason;
          const game = String(entry.game || "REEFSCAPE");
          const event = String(entry.eventName || entry.eventKey || "Unknown");
          const matchType = String(entry.matchType || "").toLowerCase();
          const matchNumber = String(entry.matchNumber || "").trim();
          const matchId = String(entry.matchId || "").trim();
          const match = matchId
            ? matchId.toUpperCase()
            : matchType && matchNumber
            ? `${matchType[0].toUpperCase()}${matchNumber}`
            : matchNumber
            ? `M${matchNumber}`
            : "Unknown";
          const practiceMode = String(entry.practiceMode || "").toLowerCase();
          const difficulty = String(entry.difficulty || "").trim();
          const hasPracticeMeta = practiceMode.length > 0 && difficulty.length > 0;
          const isPractice = Boolean(entry.isPracticeScouting) || hasPracticeMeta;
          const timestampForEventWindow =
            (typeof entry.submittedAt === "number" ? entry.submittedAt : 0) ||
            (typeof entry.timestamp === "number" ? entry.timestamp : 0);
          const entryGame = (String(entry.game || "REEFSCAPE").toUpperCase() === "REBUILT" ? "REBUILT" : "REEFSCAPE") as AnalyticsGame;
          const eventWindow = eventsByGame.get(entryGame)?.get(eventKey);
          const insideEventWindow = isInEventWindow(timestampForEventWindow, eventWindow?.startDate, eventWindow?.endDate);
          if (!isPractice && eventKey && insideEventWindow) {
            eventKeys.add(eventKey);
          }
          if (!isPractice) return;
          practiceEntries += 1;
          const scoutingType: "Trial" | "Competitive" | "Real Competition" = isPractice
            ? practiceMode === "competitive"
              ? "Competitive"
              : "Trial"
            : "Real Competition";
          const difficultyLabel = difficulty || (isPractice ? "Unknown" : "N/A");
          const accuracy = typeof entry.accuracy === "number" ? Number(entry.accuracy) : null;
          const key = `${season}|${game}|${event}|${match}|${scoutingType}|${difficultyLabel}`;
          const existing = breakdownMap.get(key) || {
            season,
            game,
            event,
            match,
            scoutingType,
            difficulty: difficultyLabel,
            count: 0,
            accuracyTotal: 0,
            accuracyCount: 0,
            lastScoutedAt: 0,
          };
          existing.count += 1;
          if (accuracy !== null && Number.isFinite(accuracy)) {
            existing.accuracyTotal += accuracy;
            existing.accuracyCount += 1;
          }
          existing.lastScoutedAt = Math.max(existing.lastScoutedAt, fallbackTimestamp || 0);
          breakdownMap.set(key, existing);
        });
        setScoutingBreakdown(Array.from(breakdownMap.values()));

        let accuracyTotal = 0;
        let accuracyCount = 0;
        practiceDocs.forEach((session) => {
          if (typeof session.accuracy === "number") {
            accuracyTotal += session.accuracy;
            accuracyCount += 1;
          }
        });

        setStats({
          totalEntries: practiceEntries,
          practiceEntries,
          practiceSessions: practiceDocs.size,
          avgAccuracy: accuracyCount > 0 ? Math.round(accuracyTotal / accuracyCount) : 0,
          eventsScouted: eventKeys.size,
        });
      } finally {
        setLoading(false);
      }
    }
    loadProfile();
  }, [params?.userId, userData?.teamId, userData?.uid]);

  const sortedBreakdown = useMemo(() => {
    const scoutingTypeOrder: Record<string, number> = {
      "Real Competition": 0,
      Competitive: 1,
      Trial: 2,
    };
    const rows = [...scoutingBreakdown];
    rows.sort((a, b) => {
      const direction = sortDir === "asc" ? 1 : -1;
      switch (sortKey) {
        case "lastScoutedAt":
          return direction * ((a.lastScoutedAt || 0) - (b.lastScoutedAt || 0));
        case "season":
          return direction * (a.season - b.season);
        case "game":
          return direction * a.game.localeCompare(b.game);
        case "event":
          return direction * a.event.localeCompare(b.event);
        case "match":
          return direction * a.match.localeCompare(b.match);
        case "scoutingType":
          return direction * ((scoutingTypeOrder[a.scoutingType] ?? 99) - (scoutingTypeOrder[b.scoutingType] ?? 99));
        case "difficulty":
          return direction * a.difficulty.localeCompare(b.difficulty);
        case "accuracy":
          return direction * (((a.accuracyCount > 0 ? a.accuracyTotal / a.accuracyCount : -1) - (b.accuracyCount > 0 ? b.accuracyTotal / b.accuracyCount : -1)));
        case "count":
          return direction * (a.count - b.count);
        default:
          return 0;
      }
    });
    return rows;
  }, [scoutingBreakdown, sortDir, sortKey]);

  function handleSort(nextKey: typeof sortKey) {
    if (nextKey === sortKey) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDir("asc");
  }

  function sortIndicator(column: typeof sortKey) {
    if (sortKey !== column) return "↕";
    return sortDir === "asc" ? "↑" : "↓";
  }

  if (loading) {
    return (
      <div className="flex h-screen bg-gray-100">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center">
          <LoadingSpinner message="Loading profile..." />
        </div>
      </div>
    );
  }
  const entriesLabel =
    stats.totalEntries > 0 && stats.practiceEntries === stats.totalEntries
      ? "Practice Entries"
      : "Scouting Entries";
  const roleBadge = profile ? getRoleBadge(profile.role, profile.roles) : null;
  const initials = profile?.displayName
    ?.split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "U";

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8">
        {!profile ? (
          <div className="bg-white rounded-xl shadow-md p-8 text-center">Profile not found.</div>
        ) : !canView ? (
          <div className="bg-white rounded-xl shadow-md p-8 text-center">
            This profile is private or restricted to team members.
          </div>
        ) : (
          <div className="max-w-5xl mx-auto space-y-6">
            <div className="bg-white rounded-xl shadow-md p-6">
              <div className="flex items-center gap-4">
                {profile.photoURL ? (
                  <img src={profile.photoURL} alt={profile.displayName} className="w-20 h-20 rounded-full object-cover border border-gray-200" />
                ) : (
                  <div className="w-20 h-20 rounded-full bg-gray-200 flex items-center justify-center text-xl font-bold">
                    {initials}
                  </div>
                )}
                <div>
                  <h1 className="text-3xl font-bold theme-text mb-1">{profile.displayName}</h1>
                  <p className="text-gray-600">{profile.email}</p>
                  {roleBadge && (
                    <p className={`inline-block mt-1 px-2 py-0.5 rounded text-xs ${roleBadge.bg} ${roleBadge.text}`}>
                      {roleBadge.label}
                    </p>
                  )}
                  <p className="text-xs text-gray-500 mt-1">Visibility: {profile.profileVisibility || "team"}</p>
                </div>
              </div>
              {profile.bio && (
                <div className="mt-4 p-3 rounded-lg border border-gray-200">
                  <p className="text-sm text-gray-700">{profile.bio}</p>
                </div>
              )}
            </div>
            <div className="bg-white rounded-xl shadow-md p-6">
              <h2 className="text-xl font-semibold mb-3">Team</h2>
              <p className="text-lg font-medium">Team {teamLabel}</p>
            </div>
            <div className="bg-white rounded-xl shadow-md p-6">
              <h2 className="text-xl font-semibold mb-3">Stats</h2>
              <div className="md:hidden -mx-2 px-2 overflow-x-auto touch-pan-x snap-x snap-mandatory">
                <div className="flex gap-4 w-max pb-2">
                  <div className="snap-start min-w-[200px] p-4 border border-gray-200 rounded-lg text-center">
                    <p className="text-xs text-gray-500">{entriesLabel}</p>
                    <p className="text-2xl font-bold">{stats.totalEntries}</p>
                  </div>
                  <div className="snap-start min-w-[200px] p-4 border border-gray-200 rounded-lg text-center">
                    <p className="text-xs text-gray-500">Practice Sessions</p>
                    <p className="text-2xl font-bold">{stats.practiceSessions}</p>
                  </div>
                  {canViewAccuracy && (
                    <div className="snap-start min-w-[200px] p-4 border border-gray-200 rounded-lg text-center">
                      <p className="text-xs text-gray-500">Avg Accuracy</p>
                      <p className="text-2xl font-bold">{stats.avgAccuracy}%</p>
                    </div>
                  )}
                  <div className="snap-start min-w-[200px] p-4 border border-gray-200 rounded-lg text-center">
                    <p className="text-xs text-gray-500">Events</p>
                    <p className="text-2xl font-bold">{stats.eventsScouted}</p>
                  </div>
                </div>
              </div>
              <div className={`hidden md:grid ${canViewAccuracy ? "grid-cols-4" : "grid-cols-3"} gap-3 text-center`}>
                <div className="p-3 border border-gray-200 rounded-lg">
                  <p className="text-xs text-gray-500">{entriesLabel}</p>
                  <p className="text-2xl font-bold">{stats.totalEntries}</p>
                </div>
                <div className="p-3 border border-gray-200 rounded-lg">
                  <p className="text-xs text-gray-500">Practice Sessions</p>
                  <p className="text-2xl font-bold">{stats.practiceSessions}</p>
                </div>
                {canViewAccuracy && (
                  <div className="p-3 border border-gray-200 rounded-lg">
                    <p className="text-xs text-gray-500">Avg Accuracy</p>
                    <p className="text-2xl font-bold">{stats.avgAccuracy}%</p>
                  </div>
                )}
                <div className="p-3 border border-gray-200 rounded-lg">
                  <p className="text-xs text-gray-500">Events</p>
                  <p className="text-2xl font-bold">{stats.eventsScouted}</p>
                </div>
              </div>
              <div className="mt-6">
                <h3 className="text-sm font-semibold text-gray-700 mb-2">
                  By Season / Game / Event / Match / Type / Difficulty{canViewAccuracy ? " / Accuracy" : ""}
                </h3>
                {scoutingBreakdown.length === 0 ? (
                  <p className="text-sm text-gray-500">No scouting entries yet.</p>
                ) : (
                  <div className="overflow-x-auto touch-pan-x">
                    <table className="w-full min-w-[980px] text-sm">
                      <thead>
                        <tr className="text-left text-gray-500">
                          <th className="py-1 cursor-pointer" onClick={() => handleSort("lastScoutedAt")}>Date {sortIndicator("lastScoutedAt")}</th>
                          <th className="py-1 cursor-pointer" onClick={() => handleSort("season")}>Season {sortIndicator("season")}</th>
                          <th className="py-1 cursor-pointer" onClick={() => handleSort("game")}>Game {sortIndicator("game")}</th>
                          <th className="py-1 cursor-pointer" onClick={() => handleSort("event")}>Event {sortIndicator("event")}</th>
                          <th className="py-1 cursor-pointer" onClick={() => handleSort("match")}>Match {sortIndicator("match")}</th>
                          <th className="py-1 cursor-pointer" onClick={() => handleSort("scoutingType")}>Type {sortIndicator("scoutingType")}</th>
                          <th className="py-1 cursor-pointer" onClick={() => handleSort("difficulty")}>Difficulty {sortIndicator("difficulty")}</th>
                          {canViewAccuracy && (
                            <th className="py-1 text-right cursor-pointer" onClick={() => handleSort("accuracy")}>
                              Accuracy {sortIndicator("accuracy")}
                            </th>
                          )}
                          <th className="py-1 text-right cursor-pointer" onClick={() => handleSort("count")}>Entries {sortIndicator("count")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedBreakdown.map((row) => (
                          <tr key={`${row.season}-${row.game}-${row.event}-${row.match}-${row.scoutingType}-${row.difficulty}`} className="border-t border-gray-100">
                            <td className="py-1">{row.lastScoutedAt > 0 ? new Date(row.lastScoutedAt).toLocaleDateString() : "-"}</td>
                            <td className="py-1">{row.season}</td>
                            <td className="py-1">{row.game}</td>
                            <td className="py-1">{row.event}</td>
                            <td className="py-1 font-medium">{row.match}</td>
                            <td className="py-1">{row.scoutingType}</td>
                            <td className="py-1">
                              {row.difficulty === "N/A"
                                ? "N/A"
                                : row.difficulty
                                    .split("-")
                                    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
                                    .join(" ")}
                            </td>
                            {canViewAccuracy && (
                              <td className="py-1 text-right font-semibold">
                                {row.accuracyCount > 0 ? `${Math.round(row.accuracyTotal / row.accuracyCount)}%` : "-"}
                              </td>
                            )}
                            <td className="py-1 text-right font-semibold">{row.count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <ProtectedRoute requireAuth={true}>
      <ProfileContent />
    </ProtectedRoute>
  );
}

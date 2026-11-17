"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EVENT_CONFIG } from "@/config/event";
import { authedApi } from "@/lib/api-client";
import { currentSeasonFor } from "@/lib/events/event-status";
import { useProgram, useProgramConfig } from "@/lib/program/context";
import { computeProfileStats } from "@/lib/profile/stats";
import { useScoutStatsSources } from "@/lib/scout-stats/use-scout-stats";
import { EMPTY_ACHIEVEMENT_CONFIG, parseAchievementConfig, type AchievementConfig } from "./config";
import type { AchievementFacts } from "./metrics";
import { buildItems, type AchievementItem } from "./view";

// Session 8: the browser side of achievements. The team's settings come from the server route (the Admin SDK reads the document; no client rule),
// and the numbers from the same stats the profile page computes. Both programs use this one hook.

export type AchievementConfigState = { config: AchievementConfig; status: "loading" | "ready" | "error"; error: string | null; reload: () => void };

/** The effective settings for the caller's active team. A failed read keeps the built-ins (names are cosmetic) and says so. */
export function useAchievementConfig(enabled = true): AchievementConfigState {
  const program = useProgram();
  const [state, setState] = useState<{ config: AchievementConfig; status: "loading" | "ready" | "error"; error: string | null }>({ config: EMPTY_ACHIEVEMENT_CONFIG, status: "loading", error: null });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    authedApi<{ config?: unknown }>(`/api/achievements/config?program=${encodeURIComponent(program)}`)
      .then((res) => {
        if (!cancelled) setState({ config: parseAchievementConfig(res.config), status: "ready", error: null });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ config: EMPTY_ACHIEVEMENT_CONFIG, status: "error", error: err instanceof Error ? err.message : "Couldn't load the achievement settings." });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, program, nonce]);

  const reload = useCallback(() => {
    setState((s) => ({ ...s, status: "loading" }));
    setNonce((n) => n + 1);
  }, []);
  return { ...state, reload };
}

/** Items for given facts (null facts = still loading). */
export function useAchievementItems(facts: AchievementFacts | null, config: AchievementConfig): AchievementItem[] | null {
  const { achievementMetrics } = useProgramConfig();
  return useMemo(() => (facts ? buildItems(config, facts, achievementMetrics) : null), [facts, config, achievementMetrics]);
}

export type MyAchievements =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; items: AchievementItem[]; settingsError: string | null; noTeam: boolean };

/**
 * The signed-in person's own achievements, with progress. No team: nothing is read from a team and every achievement shows at zero
 * (the page explains what unlocks them). A failed scouting read is an error, never an empty list.
 */
export function useMyAchievements(uid: string | null, teamId: string | null): MyAchievements {
  const { event: eventRules } = useProgramConfig();
  const sources = useScoutStatsSources(teamId);
  const settings = useAchievementConfig(true);
  const [nowMs] = useState(() => Date.now());
  const hasTeam = !!teamId;

  const facts = useMemo<AchievementFacts | null>(() => {
    if (!uid) return null;
    if (!hasTeam) {
      return computeProfileStats({ uid, members: [], sessions: [], entries: [], libraryMatchesById: new Map(), attendance: [], now: new Date(nowMs), eventScope: { season: currentSeasonFor(eventRules.seasonKind, nowMs, EVENT_CONFIG.season), keyShape: eventRules.keyShape } }).achievementFacts;
    }
    if (!sources.loaded) return null;
    return computeProfileStats({
      uid,
      members: sources.members,
      sessions: sources.sessions,
      entries: sources.entries,
      libraryMatchesById: sources.libraryMatchesById,
      attendance: sources.attendance,
      now: new Date(nowMs),
      eventScope: { season: currentSeasonFor(eventRules.seasonKind, nowMs, EVENT_CONFIG.season), keyShape: eventRules.keyShape },
    }).achievementFacts;
  }, [uid, hasTeam, sources.loaded, sources.members, sources.sessions, sources.entries, sources.libraryMatchesById, sources.attendance, nowMs, eventRules.seasonKind, eventRules.keyShape]);

  const items = useAchievementItems(facts, settings.config);
  const sourceError = hasTeam ? (sources.sourceErrors[0] ?? null) : null;
  if (sourceError) return { status: "error", message: `${sourceError.title}. Check your connection and reload the page.` };
  if (!items || settings.status === "loading") return { status: "loading" };
  return { status: "ready", items, settingsError: settings.status === "error" ? settings.error : null, noTeam: !hasTeam };
}

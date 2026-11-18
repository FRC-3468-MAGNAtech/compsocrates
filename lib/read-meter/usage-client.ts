"use client";

import { useCallback, useEffect, useState } from "react";
import { authedApi } from "@/lib/api-client";
import { summarizeUsage, type DayDoc, type UsageSummary } from "@/lib/read-meter/model";

/** The Read usage tab's data: `/api/platform/read-meter` (platform owner only, at most 15 document reads). Loaded when the tab opens and on Refresh, never on a timer. */
export function useReadUsage() {
  const [state, setState] = useState<{ enabled: boolean; summary: UsageSummary } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    authedApi<{ enabled: boolean; days: { day: string; data: DayDoc | null }[] }>("/api/platform/read-meter").then(
      (json) => {
        if (!alive) return;
        setState({ enabled: json.enabled === true, summary: summarizeUsage(json.days ?? []) });
        setError(null);
        setLoading(false);
      },
      (err: unknown) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : "Couldn't load the read usage.");
        setLoading(false);
      }
    );
    return () => {
      alive = false;
    };
  }, [attempt]);

  const refresh = useCallback(() => {
    setLoading(true);
    setAttempt((n) => n + 1);
  }, []);
  return { state, error, loading, refresh };
}

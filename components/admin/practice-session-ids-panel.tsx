"use client";

import { useMemo, useState } from "react";
import { IdRow, IdToolShell, ID_ROW_CAP, useOneShot } from "@/components/admin/id-tool-shell";
import { useAuth } from "@/lib/auth";
import { filterPracticeSessionIdRows, formatSubmitted, practiceSessionIdRows } from "@/lib/admin/id-tools";
import { useAllTeamPracticeSessions } from "@/lib/practice-sessions";
import { getEntries, type ScoutEntry } from "@/lib/scout-entries";

const NO_ENTRIES: ScoutEntry[] = [];

/**
 * CS "Practice Session IDs" (admin utility): search the document IDs of the team's practice sessions (solo, live and lobby) and copy one. Each row
 * is summarised from the entries saved under that session, as in CS. The sessions are live; Refresh re-reads the entries. Admin-only.
 */
export function PracticeSessionIdsPanel() {
  const { profile } = useAuth();
  const teamId = profile?.teamId ?? null;
  const { sessions, loaded } = useAllTeamPracticeSessions(teamId);
  const { data, error, loading, refreshing, refresh } = useOneShot(teamId, getEntries, "practice session IDs load failed", NO_ENTRIES);
  const [search, setSearch] = useState("");
  const rows = useMemo(() => practiceSessionIdRows(sessions, data ?? NO_ENTRIES), [sessions, data]);
  const filtered = useMemo(() => filterPracticeSessionIdRows(rows, search), [rows, search]);

  return (
    <IdToolShell
      title="Practice Session IDs"
      description="Search practice session document IDs."
      searchLabel="Search practice session IDs"
      placeholder="Search by session ID, scout, match, team, event, or score"
      search={search}
      onSearch={setSearch}
      loading={loading || !loaded}
      refreshing={refreshing}
      error={error}
      onRefresh={refresh}
      total={rows.length}
      shown={filtered.length}
      noun="sessions"
    >
      <ul className="flex flex-col gap-2" aria-label="Practice sessions, newest first">
        {filtered.slice(0, ID_ROW_CAP).map((r) => (
          <IdRow
            key={r.id}
            id={r.id}
            fields={[
              { label: "Scout", value: r.scoutSummary === "-" ? r.scoutId || "-" : r.scoutSummary },
              { label: "Match", value: r.matchSummary },
              { label: "Type / game", value: r.matchType || "-", sub: r.game || "-" },
              { label: "Team", value: r.teamSummary },
              { label: "Event", value: r.event || "-" },
              { label: "Score / accuracy", value: r.totalScore, sub: r.averageAccuracy === null ? "-" : `${r.averageAccuracy}%` },
              { label: "Submitted", value: formatSubmitted(r.submittedAt) },
            ]}
          />
        ))}
      </ul>
    </IdToolShell>
  );
}

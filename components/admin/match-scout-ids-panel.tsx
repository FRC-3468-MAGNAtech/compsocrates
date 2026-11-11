"use client";

import { useMemo, useState } from "react";
import { IdRow, IdToolShell, ID_ROW_CAP, useOneShot } from "@/components/admin/id-tool-shell";
import { useAuth } from "@/lib/auth";
import { filterMatchScoutIdRows, formatSubmitted, matchScoutIdRows } from "@/lib/admin/id-tools";
import { getEntries, type ScoutEntry } from "@/lib/scout-entries";

const NO_ENTRIES: ScoutEntry[] = [];

/**
 * CS "Match Scout IDs" (admin utility): search the document IDs of the team's official match-scouting entries (practice scouting is left out, as in
 * CS) and copy one. Newest first, filtered by one search box over every column, with Refresh. Admin-only, like the rest of the Admin Panel.
 */
export function MatchScoutIdsPanel() {
  const { profile } = useAuth();
  const { data, error, loading, refreshing, refresh } = useOneShot(profile?.teamId ?? null, getEntries, "match scout IDs load failed", NO_ENTRIES);
  const [search, setSearch] = useState("");
  const rows = useMemo(() => matchScoutIdRows(data ?? NO_ENTRIES), [data]);
  const filtered = useMemo(() => filterMatchScoutIdRows(rows, search), [rows, search]);

  return (
    <IdToolShell
      title="Match Scout IDs"
      description="Search official match scouting document IDs."
      searchLabel="Search match scout IDs"
      placeholder="Search by ID, scout, match, team, or event"
      search={search}
      onSearch={setSearch}
      loading={loading}
      refreshing={refreshing}
      error={error}
      onRefresh={refresh}
      total={rows.length}
      shown={filtered.length}
      noun="entries"
    >
      <ul className="flex flex-col gap-2" aria-label="Match scouting entries, newest first">
        {filtered.slice(0, ID_ROW_CAP).map((r) => (
          <IdRow
            key={r.id}
            id={r.id}
            notes={r.notes || undefined}
            fields={[
              { label: "Scout", value: r.scoutName || r.scoutId || "-" },
              { label: "Match", value: r.match },
              { label: "Type / game", value: r.matchType, sub: r.game || "-" },
              { label: "Team", value: r.team || "-" },
              { label: "Event", value: r.event || "-" },
              { label: "Score / accuracy", value: r.score, sub: r.accuracy === null ? "-" : `${r.accuracy}%` },
              { label: "Submitted", value: formatSubmitted(r.submittedAt) },
            ]}
          />
        ))}
      </ul>
    </IdToolShell>
  );
}

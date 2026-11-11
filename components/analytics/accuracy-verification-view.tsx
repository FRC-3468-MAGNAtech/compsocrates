"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { HighAccuracyCard, RescoutRow, SectionCard, VerifiedBadge } from "@/components/analytics/verification-sections";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Shimmer } from "@/components/ui/shimmer";
import { highAccuracyMatches, leadVerificationRows, rescoutGame, scheduleAlliances, type AllianceGroup, type HighAccuracyMatch } from "@/lib/analytics/accuracy-verification";
import { entryMatchId, entryToDoc, formatMatchIdLong } from "@/lib/analytics/cs-docs";
import { useAnalyticsData, useAnalyticsEntries } from "@/lib/analytics/data-context";
import { useAnalyticsFilters } from "@/lib/analytics/filter-context";
import { groupComparisons, originalEntriesByKey, practiceEntriesBySession } from "@/lib/analytics/rescout-compare";
import { RESCOUT_COMPARE_MIN_ACCURACY, groupRescouts, planRescoutUpdates, rescoutGroupKey, rescoutedTeamKeys, type Rescout, type RescoutAlliance } from "@/lib/analytics/rescouts";
import { applyRescoutPatches, createRescout, deleteRescout, useAccuracyRescouts } from "@/lib/analytics/use-accuracy-rescouts";
import { useLeadMatchLogs } from "@/lib/analytics/use-lead-match-logs";
import { useEventMatches } from "@/lib/analytics/use-event-data";
import { useAuth } from "@/lib/auth";
import type { CsDoc } from "@/lib/games/types";
import type { ScoutEntry } from "@/lib/scout-entries";

type Active = { match: HighAccuracyMatch; alliance: AllianceGroup };

/**
 * Accuracy Verification: lead-scout versus junior verification, the matches accurate enough to be re-scouted, and the re-scouts made so far
 * (with their accuracy and a link to compare each against the live scouting). Follows the shared Game and Event filters.
 */
export function AccuracyVerificationView() {
  const router = useRouter();
  const { profile, user } = useAuth();
  const uid = user?.uid ?? "";
  const teamId = profile?.teamId ?? null;
  const data = useAnalyticsData();
  const { filters } = useAnalyticsFilters();
  // The accuracy filter does not apply here: this page is about which matches are accurate.
  const { entries, loaded } = useAnalyticsEntries(undefined, { applyAccuracy: false });
  const { rescouts, loaded: rescoutsLoaded, error: rescoutsError } = useAccuracyRescouts(teamId);
  const { logs, loaded: logsLoaded } = useLeadMatchLogs(teamId);

  const eventCodes = useMemo(() => [...new Set(entries.map((e) => e.eventCode))], [entries]);
  const requests = useMemo(() => eventCodes.map((code) => ({ code, season: data.eventDirectory.get(code)?.season ?? data.season })), [eventCodes, data.eventDirectory, data.season]);
  const { matches: official } = useEventMatches(requests);
  const schedule = useMemo(() => scheduleAlliances(official), [official]);

  const realEntries = useMemo(() => entries.filter((e) => e.source === "event"), [entries]);

  // --- lead versus junior ---------------------------------------------------------------------------------------------
  const juniors = useMemo(() => realEntries.flatMap((entry): Array<{ entry: ScoutEntry; doc: CsDoc }> => {
    const doc = entryToDoc(entry);
    return doc ? [{ entry, doc }] : [];
  }), [realEntries]);
  const verificationRows = useMemo(() => leadVerificationRows(juniors, logs.filter((l) => eventCodes.includes(l.eventKey))), [juniors, logs, eventCodes]);

  // --- high-accuracy matches and re-scouts ------------------------------------------------------------------------------
  const matches = useMemo(() => highAccuracyMatches(realEntries, schedule, data.eventNameOf), [realEntries, schedule, data.eventNameOf]);
  const groups = useMemo(() => groupRescouts(rescouts), [rescouts]);
  const doneTeams = useMemo(() => rescoutedTeamKeys(rescouts, groups.values()), [rescouts, groups]);
  const originals = useMemo(() => originalEntriesByKey(data.allEntries), [data.allEntries]);
  const sessions = useMemo(() => practiceEntriesBySession(data.allEntries), [data.allEntries]);
  const comparisons = useMemo(() => groupComparisons(groups.values(), originals, sessions, RESCOUT_COMPARE_MIN_ACCURACY), [groups, originals, sessions]);

  const isComplete = (eventKey: string, matchKey: string, alliance: RescoutAlliance) => groups.get(rescoutGroupKey(eventKey, matchKey, alliance))?.complete === true;
  const groupAccuracy = (eventKey: string, matchKey: string, alliance: RescoutAlliance) => groups.get(rescoutGroupKey(eventKey, matchKey, alliance))?.accuracy ?? null;

  // CS writes each complete group's accuracy, critical flag and difference back onto its re-scout rows. Each distinct write is sent once.
  const sent = useRef(new Set<string>());
  useEffect(() => {
    if (!rescoutsLoaded || rescoutsError || !data.loaded) return;
    const fresh = planRescoutUpdates(groups.values(), comparisons, Date.now()).filter((p) => {
      const { comparisonComputedAt: _ignored, ...stable } = p.patch;
      void _ignored;
      const key = `${p.id}:${JSON.stringify(stable)}`;
      if (sent.current.has(key)) return false;
      sent.current.add(key);
      return true;
    });
    if (fresh.length > 0) void applyRescoutPatches(fresh);
  }, [rescoutsLoaded, rescoutsError, data.loaded, groups, comparisons]);

  const critical = useMemo(() => rescouts.filter((r) => r.criticalFlag), [rescouts]);
  const mine = useMemo(() => rescouts.filter((r) => uid !== "" && r.scoutId === uid).sort((a, b) => b.createdAt - a.createdAt), [rescouts, uid]);

  // --- actions ----------------------------------------------------------------------------------------------------------
  const [active, setActive] = useState<Active | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Rescout | null>(null);

  const startRescout = async (team: number) => {
    if (!active || !profile || !teamId || !uid || saving) return;
    const { match, alliance } = active;
    if (!match.eventKey) {
      setProblem("Unable to determine the event for this match. Select a specific event and try again.");
      return;
    }
    setSaving(true);
    setProblem(null);
    try {
      const allianceEntries = realEntries.filter((e) => e.eventCode === match.eventKey && entryMatchId(e) === match.matchKey);
      const game = rescoutGame(allianceEntries);
      const id = await createRescout({
        teamId,
        eventKey: match.eventKey,
        eventName: match.eventName,
        matchKey: match.matchKey,
        matchLabel: match.matchLabel,
        game,
        alliance: alliance.alliance,
        teamNumber: team,
        scoutId: uid,
        scoutName: profile.name,
        originalScouts: alliance.scouts,
      });
      setActive(null);
      const params = new URLSearchParams({ rescoutId: id, matchKey: match.matchKey, teamNumber: String(team), alliance: alliance.alliance, game, eventKey: match.eventKey, eventName: match.eventName });
      router.push(`/practice-scouting?${params.toString()}`);
    } catch (error) {
      setProblem(`Could not start the re-scout request: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    const target = deleteTarget;
    if (!target) return;
    setDeleteTarget(null);
    try {
      await deleteRescout(target.id);
    } catch {
      setProblem("Could not delete the re-scout entry.");
    }
  };

  const busy = !loaded || !rescoutsLoaded || !logsLoaded;

  return (
    <div className="flex flex-col gap-4">
      <GlassPanel className="p-5">
        <h2 className="text-xl font-semibold tracking-tight">Accuracy Verification</h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">High-accuracy matches are ready to be re-scouted by experienced scouts for verification.</p>
      </GlassPanel>

      {filters.practice && <p className="text-xs text-[var(--muted-foreground)]">Practice data is not verified here. Turn Practice off in the filters to see real-event matches.</p>}
      {rescoutsError && (
        <GlassPanel className="flex items-start gap-3 py-4 text-sm" role="alert">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden />
          <span>Re-scout requests could not be loaded, so the re-scout lists are empty.</span>
        </GlassPanel>
      )}
      {problem && (
        <GlassPanel className="flex items-start gap-3 py-4 text-sm" role="alert">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden />
          <span>{problem}</span>
        </GlassPanel>
      )}

      {busy ? (
        <div aria-busy="true" aria-label="Loading accuracy verification" className="flex flex-col gap-3">
          <Shimmer className="h-32" />
          <Shimmer className="h-48" />
        </div>
      ) : (
        <>
          <SectionCard
            title="Lead Scout Verification Engine"
            description="Junior submissions are compared against lead scout match logs using event-count and status tolerances."
            items={verificationRows}
            empty="No lead/junior pairs are available for the current filters."
          >
            {() =>
              verificationRows.map(({ entry, result }) => (
                <div key={entry.id} className="rounded-2xl border border-amber-400/30 bg-white/5 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold">
                        {formatMatchIdLong(entryMatchId(entry))} - Team {entry.teamNumber || "-"}
                      </p>
                      <p className="text-xs text-[var(--muted-foreground)]">Scout: {entry.scoutName || "Unknown"}</p>
                    </div>
                    <VerifiedBadge verified={result.verified} accuracy={result.accuracy} />
                  </div>
                  {result.mismatches.length > 0 && <p className="mt-2 text-xs text-[var(--muted-foreground)]">Mismatches: {result.mismatches.map((m) => m.label).join(", ")}</p>}
                </div>
              ))
            }
          </SectionCard>

          <SectionCard title="Critical Flagged Matches" description="Matches where re-scouted accuracy diverges from live scouting." items={critical} empty="No critical flags yet.">
            {(visible) => visible.map((row) => <RescoutRow key={row.id} row={row} showScout complete={row.alliance !== null && isComplete(row.eventKey, row.matchKey, row.alliance)} />)}
          </SectionCard>

          <SectionCard title="High Accuracy Matches" description={`Matches with 75% or better alliance accuracy and a full alliance of robots scouted.`} items={matches} empty="No high-accuracy matches available yet.">
            {(visible) =>
              visible.map((match) => (
                <HighAccuracyCard
                  key={match.key}
                  match={match}
                  isComplete={(m, alliance) => isComplete(m.eventKey, m.matchKey, alliance)}
                  accuracyOf={(m, alliance) => groupAccuracy(m.eventKey, m.matchKey, alliance)}
                  onRescout={(m, alliance) => {
                    setProblem(null);
                    setActive({ match: m, alliance });
                  }}
                />
              ))
            }
          </SectionCard>

          <SectionCard title="Your Re-scouted Matches" description="Matches you have re-scouted or are currently working on." items={mine} empty="You have not re-scouted any matches yet.">
            {(visible) => visible.map((row) => <RescoutRow key={row.id} row={row} complete={row.alliance !== null && isComplete(row.eventKey, row.matchKey, row.alliance)} />)}
          </SectionCard>

          {profile?.isAdmin && (
            <SectionCard title="All Re-scouted Matches" description="All re-scout submissions for this team." items={rescouts} empty="No re-scout submissions yet.">
              {(visible) =>
                visible.map((row) => <RescoutRow key={row.id} row={row} showScout complete={row.alliance !== null && isComplete(row.eventKey, row.matchKey, row.alliance)} onDelete={setDeleteTarget} />)
              }
            </SectionCard>
          )}
        </>
      )}

      <Dialog open={active !== null} onOpenChange={(open) => !open && setActive(null)}>
        <DialogContent>
          <DialogTitle>Re-scout match</DialogTitle>
          <DialogDescription>
            {active ? `${active.match.eventName} - ${active.match.matchLabel} - ${active.alliance.alliance === "red" ? "Red" : "Blue"} Alliance. Pick the robot to re-scout.` : ""}
          </DialogDescription>
          <div className="mt-4 grid grid-cols-1 gap-2">
            {active?.alliance.teams.map((team) => {
              const exists = doneTeams.has(`${active.match.eventKey}::${active.match.matchKey}::${team}`);
              return (
                <Button key={team} variant="outline" size="lg" className="min-h-11 justify-start" disabled={exists || saving} onClick={() => void startRescout(team)}>
                  Team {team} {exists ? "(Already re-scouted)" : ""}
                </Button>
              );
            })}
          </div>
          <div className="mt-4 flex justify-end">
            <Button variant="ghost" className="min-h-11" onClick={() => setActive(null)}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogTitle>Delete this re-scout entry?</DialogTitle>
          <DialogDescription>
            {deleteTarget ? `${deleteTarget.matchLabel || "Match"} - Team ${deleteTarget.teamNumber}. This cannot be undone.` : ""}
          </DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" className="min-h-11" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="danger" className="min-h-11" onClick={() => void confirmDelete()}>
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

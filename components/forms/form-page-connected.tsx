"use client";

import { Suspense, useCallback, useMemo, useRef, useState } from "react";
import { ListChecks } from "lucide-react";
import { FormPageView, type PickedMatch } from "@/components/forms/form-page";
import { PhotoUploadProvider } from "@/components/forms/photo-upload";
import { MatchPickerDialog } from "@/components/scout/match-picker-dialog";
import { FieldLabel } from "@/components/scout/field-inputs";
import { useSubmissionLockout } from "@/components/forms/submission-lockout";
import { GameSelect } from "@/components/scout/game-select";
import { Button } from "@/components/ui/button";
import { Shimmer } from "@/components/ui/shimmer";
import { useActiveEvents } from "@/lib/active-event";
import { orderPrimaryFirst, pickDefaultActiveEvent } from "@/lib/active-events";
import { useEventMatches, useEventTeams } from "@/lib/analytics/use-event-data";
import { useAuth } from "@/lib/auth";
import { formMatchKey } from "@/lib/form-entries-model";
import { csGameOfSeason, editOwnFormEntry, saveFormEntry, useFormEntries } from "@/lib/form-entries";
import { eventsForSeason } from "@/lib/forms/form-season";
import { useFormSeason } from "@/lib/forms/use-form-season";
import { useFormDisplayNames } from "@/lib/forms/use-form-display-name";
import { useDocumentTitle } from "@/lib/use-document-title";
import { rookieSuggestion } from "@/lib/forms/pit-suggest";
import type { PlanCandidate } from "@/lib/forms/compare";
import { useForms } from "@/lib/forms/forms-context";
import { seasonFormId } from "@/lib/forms/builtin";
import { useProgram } from "@/lib/program/context";
import type { EventInfo } from "@/lib/events/types";
import { myAssignedTeams, type TeamAssignKind } from "@/lib/team-assignments/model";
import { useTeamAssignmentDocs } from "@/lib/team-assignments/store";

/** The match field of these forms: a button that opens the same match picker the Match Scout Form uses (Practice, Qualification, Finals with the bracket). */
function MatchPickerSlot({ label, event, matchKey, disabled, onPick }: { label: string; event: EventInfo | null; matchKey: string | null; disabled?: boolean; onPick: (m: PickedMatch) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <FieldLabel label={label} required />
      <Button type="button" variant="glass" className="h-12 w-full justify-between rounded-2xl px-4" disabled={disabled || !event} onClick={() => setOpen(true)} data-testid="match-pick">
        <span className="flex items-center gap-2">
          <ListChecks className="h-4 w-4" aria-hidden /> {matchKey ?? "Choose a match"}
        </span>
      </Button>
      <MatchPickerDialog open={open} onOpenChange={setOpen} activeEvent={event} onSelect={(a) => onPick({ matchKey: formMatchKey(a.type, a.match.matchNumber), matchType: a.type, match: a.match })} />
    </div>
  );
}

/**
 * A match-based form page on live data: the account's active events, the FIRST schedule and teams, the plan entries, and `formEntries` for saving.
 * Session E: the page's name is built from the open season's game and the form's type (`formDisplayName`), a Game select (kept in the URL's `game` query)
 * chooses the season, and the team's submission switches apply to it. `useSearchParams` needs the Suspense boundary for the static build.
 */
export function FormPage(props: FormPageProps) {
  return (
    <Suspense fallback={<Shimmer className="h-64" />}>
      <FormPageContent {...props} />
    </Suspense>
  );
}

type FormPageProps = {
  formId: string;
  subtitle: string;
  /** P29: the Helper form leaves the event picker out while only one event is active. */
  hideEventPickerIfSingle?: boolean;
  /** P29: the photo path kind ("pit" for the Pit Scout Form). */
  photoKind?: string;
  /** P31: which assignment (Pit Scouting or Team Strategy) feeds the "My assigned teams" quick-pick and its progress; omitted = no quick-pick. */
  assignmentKind?: TeamAssignKind;
};

function FormPageContent({
  formId: pageFormId,
  subtitle,
  hideEventPickerIfSingle,
  photoKind,
  assignmentKind,
}: FormPageProps) {
  const { user, profile } = useAuth();
  const program = useProgram();
  const teamId = profile?.teamId ?? null;
  const forms = useForms();
  // CS rebuild: the page names the REBUILT form; the non-match forms exist for REBUILT only, so the page resolves to that set
  const formId = seasonFormId(pageFormId);
  const form = forms.latest(formId);
  const { events: allActive, primaryCode, loaded } = useActiveEvents();
  const [now] = useState(() => Date.now());
  // Session E: the season the page is open on: the URL's `game`, else the active event's season, else the program's current one
  const { seasonId, setSeasonId } = useFormSeason(pickDefaultActiveEvent({ events: allActive, primaryCode }, now));
  const lockout = useSubmissionLockout(teamId, seasonId);
  const names = useFormDisplayNames(seasonId);
  const events = useMemo(() => eventsForSeason(allActive, forms.seasons, seasonId, forms.defaultSeasonId), [allActive, forms.seasons, forms.defaultSeasonId, seasonId]);
  const ordered = useMemo(() => orderPrimaryFirst({ events, primaryCode }), [events, primaryCode]);
  const defaultEvent = pickDefaultActiveEvent({ events, primaryCode }, now);
  const game = csGameOfSeason(seasonId);
  const title = form ? names.forForm(form) : "";
  useDocumentTitle(title);
  const dirty = useRef(false);
  const onDirtyChange = useCallback((next: boolean) => {
    dirty.current = next;
  }, []);
  const changeSeason = (next: string) => {
    if (next === seasonId) return;
    // the answers are not saved anywhere until Submit: ask before a different game's form replaces them
    if (dirty.current && !window.confirm(`Switch to ${forms.seasonFor(next).name}? What you typed is not submitted yet and will be cleared.`)) return;
    setSeasonId(next);
  };
  const [eventCode, setEventCode] = useState<string | null>(null);
  const activeCode = ordered.some((e) => e.code === eventCode) ? eventCode : (defaultEvent?.code ?? null);
  const active = ordered.find((e) => e.code === activeCode) ?? null;

  const requests = useMemo(() => (active ? [{ code: active.code, season: active.season }] : []), [active]);
  const { matches } = useEventMatches(requests);
  const { teams } = useEventTeams(requests);
  const teamOptions = useMemo(() => teams.map((t) => ({ teamNumber: t.teamNumber, name: t.nameShort })), [teams]);

  // the plan entries (Drive Reflection compares with Match Strategy): the chosen event's entries of the other form
  const { entries } = useFormEntries(form?.compareWith ? teamId : null, { formId: form?.compareWith?.formId, eventCode: active?.code, game });
  const planEntries = useMemo<PlanCandidate[]>(() => entries.map((e) => ({ id: e.id, formId: e.formId, eventCode: e.eventCode, matchKey: e.matchKey, alliance: e.alliance, createdAtMs: e.createdAtMs, values: e.values })), [entries]);

  // P29: this form's own entries at the event (a team can have several): "You already submitted" and Edit previous read them
  const own = useFormEntries(teamId, { formId, eventCode: active?.code, game });
  const hasRookie = !!form?.sections.some((sec) => sec.fields.some((f) => f.key === "rookie"));
  const suggestFor = useMemo(
    () => (hasRookie && active ? (n: number) => rookieSuggestion(teams.find((t) => t.teamNumber === n), active.season) : undefined),
    [hasRookie, active, teams]
  );

  // P31: the teams the person was assigned for this event, and which of them they have already done
  const assignments = useTeamAssignmentDocs(assignmentKind ? teamId : null);
  const assigned = useMemo(() => {
    if (!assignmentKind) return null;
    const mine = myAssignedTeams(assignments.docs, active?.code ?? null, assignmentKind, user?.uid);
    if (mine.length === 0) return null;
    const done = new Set(own.entries.filter((e) => e.uid === user?.uid && !e.excluded && typeof e.teamNumber === "number").map((e) => e.teamNumber as number));
    return mine.map((teamNumber) => ({ teamNumber, done: done.has(teamNumber) }));
  }, [assignmentKind, assignments.docs, active?.code, user?.uid, own.entries]);

  if (!form || !loaded || !forms.loaded) return <Shimmer className="h-64" />;
  return (
    <PhotoUploadProvider>
      <FormPageView
        key={`${form.id}@${form.version}:${seasonId}`}
        form={form}
        title={title}
        subtitle={subtitle}
        events={ordered}
        eventsLoaded={loaded}
        defaultEventCode={defaultEvent?.code ?? null}
        scoutName={profile?.name ?? ""}
        matches={matches}
        teams={teamOptions}
        planEntries={planEntries}
        onEventChange={setEventCode}
        myUid={user?.uid}
        existingEntries={own.entries}
        suggestFor={suggestFor}
        hideEventPickerIfSingle={hideEventPickerIfSingle}
        photoKind={photoKind}
        lockout={lockout}
        headerExtra={<GameSelect value={seasonId} onChange={changeSeason} id="form-season" />}
        onDirtyChange={onDirtyChange}
        assignedTeams={assigned}
        onUpdate={(entry, patch) => {
          if (!teamId || !user || !profile) return Promise.reject(new Error("Not signed in."));
          return editOwnFormEntry({ teamId, uid: user.uid, name: profile.name }, entry, patch, program);
        }}
        renderMatchPicker={({ field, event, matchKey, disabled, onPick }) => <MatchPickerSlot label={field.label} event={event} matchKey={matchKey} disabled={disabled} onPick={onPick} />}
        onSave={(doc) => {
          if (!teamId || !user) return Promise.reject(new Error("Not signed in."));
          // the entry is for the season the page is open on; the shared write path refuses it when the team closed that season
          return saveFormEntry(teamId, user.uid, { ...doc, gate: { seasonId } }, program);
        }}
      />
    </PhotoUploadProvider>
  );
}

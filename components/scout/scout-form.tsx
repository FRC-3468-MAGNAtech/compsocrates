"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarX2, CheckCircle2, CloudOff, Info, Send, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CounterControl } from "@/components/scout/counter-control";
import { FieldToggle } from "@/components/scout/field-toggle";
import { CheckboxTile } from "@/components/scout/checkbox-tile";
import { ACCENT_TOKENS, FieldIcon } from "@/components/scout/field-icons";
import { FieldLabel, FieldTip, MatrixField, NumberField, RadioTiles, RatingStars, SelectField, SliderField } from "@/components/scout/field-inputs";
import { SequenceField } from "@/components/scout/sequence-field";
import { TimerList } from "@/components/scout/timer-list";
import { PhotoField } from "@/components/forms/photo-field";
import { PlanDiffIcon } from "@/components/forms/plan-diff-icon";
import { TeamSelect, type TeamOption } from "@/components/forms/team-select";
import type { PhotoTarget } from "@/components/forms/photo-upload";
import { SectionNav, type ScoutSection } from "@/components/scout/section-nav";
import { ScoreBar } from "@/components/scout/score-bar";
import { MatchPickerDialog, type AssignedMatch, type MatchMark } from "@/components/scout/match-picker-dialog";
import { TeamPickerDialog } from "@/components/scout/team-picker-dialog";
import { ConfirmDialog } from "@/components/scout/confirm-dialog";
import { pitMismatchMessages, pitPrefill, type PitValues } from "@/components/scout/pit-sync";
import type { TeamMark } from "@/components/scout/team-status";
import { SubmissionLockoutBanner } from "@/components/forms/submission-lockout";
import type { SubmissionLockout } from "@/data/cs/types";
import { springSnappy } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { BIOBUZZ_FORM } from "@/lib/forms/builtin";
import { ConnectionChip } from "@/components/layout/connection-chip";
import { connectionNotice } from "@/lib/connection-notice";
import { calculateScore, type ScoreResult } from "@/lib/forms/scoring";
import { defaultValues, normalizeValues, validateValues } from "@/lib/forms/values";
import { browserDraftStorage, clearDraft, DRAFT_DEBOUNCE_MS, draftAge, hasProgress, loadDraft, loadLastDraft, matchKeyOf, saveDraft, type Draft } from "@/lib/forms/draft";
import { settleSubmit } from "@/lib/forms/submit-state";
import { fieldWithRole } from "@/lib/forms/meta";
import { visibleFieldKeys } from "@/lib/forms/visibility";
import { isSystemField, phaseLabel, type FormValue, type Form, type FormField, type FormSection, type FormValues, type ImageValue } from "@/lib/forms/types";
import { MATCH_TYPE_PREFIX } from "@/lib/analytics/game-schema";
import type { EventInfo } from "@/lib/events/types";

export type ScoutFormMode = "event" | "practice" | "live" | "lobby";
export type ScoutFormLayout = "page" | "side-panel";

export type ScoutFormValues = {
  /** Schema-driven field values keyed by the form's field `key` (the picked match, team and scout name are separate, below). */
  values: FormValues;
  teamNumber: number | null;
  match: AssignedMatch | null;
  scoutName: string;
};

export type ScoutFormPrefill = {
  match?: AssignedMatch | null;
  teamNumber?: number | null;
  scoutName?: string;
  values?: Partial<FormValues>;
};

export type ScoutFormHandle = {
  validate: () => boolean;
  getValues: () => ScoutFormValues;
  reset: () => void;
};

export type ScoutFormProps = {
  /** The form to fill in (schema v2). Defaults to the BIOBUZZ built-in; the pages pass the season's active form. Remount (a `key`) when it changes. */
  schema?: Form;
  mode: ScoutFormMode;
  /** Active event context — only used to look up matches/teams; omit for modes with no live event (e.g. a standalone practice session). */
  activeEvent?: EventInfo | null;
  /** FIX1: every active event. With more than one, the Assigned Match section shows an Event pick; with zero or one, behavior is unchanged. */
  eventChoices?: EventInfo[];
  /** Called when the scout picks a different event — the parent swaps `activeEvent` in response. The form clears its match/team itself, since they belonged to the previous event. */
  onEventChange?: (event: EventInfo) => void;
  prefill?: ScoutFormPrefill;
  /** Keys shown but not editable: "match", "teamNumber", or any schema field key. Scout Name is always read-only regardless of this list. */
  lockedFields?: string[];
  /** Hides the Assigned Match section's pick/Request Sub-In controls (practice-style modes). */
  hideMatchPicker?: boolean;
  /** False when the parent supplies its own sticky bottom buttons — use the ref handle to drive submission instead. */
  showSubmitButton?: boolean;
  /** 'side-panel' is a compact, scrollable variant for sitting beside a video — no section nav, tighter spacing. */
  layout?: ScoutFormLayout;
  onChange?: (values: ScoutFormValues, score: ScoreResult) => void;
  /**
   * P24: where the comments field lives. `'inline'` (the Match Scout Form page) renders it with the other fields. `'popout'` (the practice workspace) leaves it out of the form:
   * the workspace's comments drawer edits it instead, through `comments` / `onCommentsChange` (the value still goes into the submitted entry like any field). Defaults to
   * `'popout'` for the side-panel layout and `'inline'` otherwise; a popout without `onCommentsChange`, or a form with no comments field, falls back to inline so the comments are never unreachable.
   */
  commentsMode?: "inline" | "popout";
  /** The comments text, controlled by the caller, in popout mode. */
  comments?: string;
  onCommentsChange?: (text: string) => void;
  /** May return a Promise (e.g. the parent's saveEntry()) — the success animation and reset only fire once it resolves. A thrown/rejected call leaves the form as-is so the parent can show its own error state. */
  onSubmit?: (values: ScoutFormValues, score: ScoreResult) => void | Promise<void>;
  /**
   * Turns on draft protection (autosave to this device, a "Restore draft?" banner, cleared on a successful submit) for this user. The draft key is
   * user + form + match + team. Omit it for modes with nothing to protect (the practice workspaces).
   */
  draftUserId?: string;
  /** CS submission lockout: blocks a NEW submission (Submit is disabled and the reason is shown). Leave out for modes that are not event scouting. */
  lockout?: SubmissionLockout;
  /** The team picker's marks for the picked match (Scouted, Sub Assigned, Sub Req, Assigned). A robot marked Scouted asks "Submit anyway?" on submit (CS duplicate-scouted confirm). */
  teamMarks?: (match: AssignedMatch | null) => ReadonlyMap<number, TeamMark>;
  /** The scout's own robot in a match (an assignment or a sub-in they took): picking the match fills the team in and the picker highlights it. */
  myTeamFor?: (match: AssignedMatch) => number | null;
  /** CS pit-sync: the picked team's pit numbers. Prefills the scale sliders once per team and warns (confirm on submit) when the scales no longer contain them. */
  pit?: { loaded: boolean; forTeam: (teamNumber: number) => PitValues | null };
  /** Marks in the match picker's lists: Scouted (already has an entry) and Assigned (to this scout). */
  matchPickerMarks?: (type: AssignedMatch["type"], matchNumber: number) => MatchMark | null;
  /** The "Request Sub-In" control, shown beside the match button (event scouting only; the page owns the data). */
  subInControl?: ReactNode;
};

const FLAG_SECTION_NOTE = "These don't affect score but are saved with the submission.";

const fieldId = (key: string) => `scout-field-${key}`;

/** A scored field's points, when it scores per toggle-on / per tally and the form scores at all (what the toggle and counter tiles show). */
function tilePoints(form: Pick<Form, "scoringEnabled">, field: FormField): number | undefined {
  const rule = field.scoring;
  if (!form.scoringEnabled || !rule || (rule.mode !== "whenOn" && rule.mode !== "perTally")) return undefined;
  return rule.value || undefined;
}

/**
 * One non-system, non-checkbox field as its input control, with its `ui` settings honoured: an accent colour (a theme token, as a left rule), an icon, and
 * the tile size; plus its scouting tip as an info popover. Shared with the admin entry editor and the builder's preview.
 */
export function RenderedField(props: RenderedFieldProps) {
  const color = props.field.ui?.color;
  const control = <RenderedFieldControl {...props} />;
  if (!color || color === "default") return control;
  return (
    <div className="rounded-2xl border-l-4 pl-3" style={{ borderColor: ACCENT_TOKENS[color] }}>
      {control}
    </div>
  );
}

type RenderedFieldProps = {
  form: Form;
  field: FormField;
  value: FormValue | undefined;
  locked: boolean;
  error?: string;
  onChange: (key: string, value: FormValue) => void;
  /** P27: where the value is stored when it isn't the field's own key (a per-team group's `t1_notes`). */
  storageKey?: string;
  /** P27: the teams at the chosen event, for a team picker inside a group. */
  teams?: TeamOption[];
  /** P27: where photos go (null until the event and team are known). */
  photoTarget?: PhotoTarget | null;
  /** P27: which photos are still uploading, by field, so a submit can attach them to the entry afterwards. */
  onPendingPhotos?: (storageKey: string, ids: string[]) => void;
  /** P27: set when this answer differs from the plan ("Planned: Hive"): a caution icon beside it. */
  planNote?: string;
};

/** A tile (toggle, counter) with its scouting tip beside it: a tile is a button, so the tip button can't live inside it. */
function TileWithTip({ field, children, planNote }: { field: FormField; children: ReactNode; planNote?: string }) {
  if (!field.tip && !planNote) return <>{children}</>;
  return (
    <div className="flex items-center gap-1">
      <div className="min-w-0 flex-1">{children}</div>
      {planNote && <PlanDiffIcon text={planNote} />}
      {field.tip && <FieldTip label={field.label} tip={field.tip} />}
    </div>
  );
}

function RenderedFieldControl({ form, field, value, locked, error, onChange, storageKey, teams, photoTarget, onPendingPhotos, planNote }: RenderedFieldProps) {
  const k = storageKey ?? field.key;
  const id = fieldId(k);
  const icon = field.ui?.icon ? <FieldIcon name={field.ui.icon} /> : undefined;
  const size = field.ui?.size;
  const wrap = (control: ReactNode) => (
    <div data-field-key={k}>
      <FieldLabel htmlFor={id} label={field.label} required={field.required} helpText={field.helpText} icon={icon} tip={field.tip} extra={planNote ? <PlanDiffIcon text={planNote} /> : undefined} />
      {control}
      {error && (
        <p role="alert" className="mt-1 text-xs font-medium text-red-300">
          {error}
        </p>
      )}
    </div>
  );

  switch (field.type) {
    case "toggle":
      return (
        <div data-field-key={k}>
          <TileWithTip field={field} planNote={planNote}>
          <FieldToggle label={field.label} pointsWhenOn={tilePoints(form, field)} helpText={field.helpText} checked={Boolean(value)} disabled={locked} size={size} icon={icon} onChange={(v) => onChange(k, v)} />
          </TileWithTip>
          {error && <p role="alert" className="mt-1 text-xs font-medium text-red-300">{error}</p>}
        </div>
      );
    case "counter":
      return (
        <div data-field-key={k}>
          <TileWithTip field={field} planNote={planNote}>
          <CounterControl
            label={field.label}
            pointsPer={tilePoints(form, field)}
            helpText={field.helpText}
            value={Number(value) || 0}
            min={field.min ?? 0}
            max={field.max}
            step={field.step ?? 1}
            disabled={locked}
            size={size}
            icon={icon}
            onChange={(v) => onChange(k, v)}
          />
          </TileWithTip>
        </div>
      );
    case "number":
      return wrap(
        <NumberField id={id} value={typeof value === "number" || typeof value === "string" ? value : ""} min={field.min} max={field.max} decimals={field.decimals} disabled={locked} invalid={!!error} placeholder={field.placeholder} onChange={(v) => onChange(k, v)} />
      );
    case "text":
      return wrap(<Input id={id} value={String(value ?? "")} disabled={locked} aria-invalid={!!error || undefined} onChange={(e) => onChange(k, e.target.value)} placeholder={field.placeholder} />);
    case "textarea":
      return wrap(<Textarea id={id} rows={3} value={String(value ?? "")} disabled={locked} aria-invalid={!!error || undefined} onChange={(e) => onChange(k, e.target.value)} placeholder={field.placeholder} />);
    case "select":
      return wrap(<SelectField id={id} value={String(value ?? "")} options={field.options ?? []} disabled={locked} placeholder={field.placeholder} onChange={(v) => onChange(k, v)} />);
    case "radio":
      return wrap(<RadioTiles label={field.label} value={String(value ?? "")} options={field.options ?? []} disabled={locked} onChange={(v) => onChange(k, v)} />);
    case "rating":
      return wrap(<RatingStars label={field.label} value={Number(value) || 0} scale={field.scale ?? 5} disabled={locked} onChange={(v) => onChange(k, v)} />);
    case "slider":
      return wrap(
        <SliderField
          id={id}
          label={field.label}
          value={typeof value === "number" ? value : (field.min ?? 1)}
          min={field.min ?? 1}
          max={field.max ?? 5}
          step={field.step ?? 1}
          ticks={field.ticks}
          endLabels={field.endLabels}
          stepLabels={field.stepLabels}
          disabled={locked}
          onChange={(v) => onChange(k, v)}
        />
      );
    case "timerList":
      // the TimerList is its own labelled group (it carries the label itself), so it isn't wrapped in a second label
      return (
        <div data-field-key={k}>
          <TimerList
            label={field.label}
            helpText={field.helpText}
            icon={icon}
            value={Array.isArray(value) ? (value as unknown[]).filter((n): n is number => typeof n === "number") : []}
            maxSeconds={field.max}
            maxCycles={field.maxCycles}
            disabled={locked}
            onChange={(v) => onChange(k, v)}
          />
          {error && <p role="alert" className="mt-1 text-xs font-medium text-red-300">{error}</p>}
        </div>
      );
    case "notice":
      return (
        <div data-field-key={k} role="note" className="glass-card flex items-start gap-3 px-4 py-3 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--muted-foreground)]" aria-hidden />
          <div className="min-w-0">
            <div className="font-semibold">{field.label}</div>
            {field.helpText && <div className="text-xs text-[var(--muted-foreground)]">{field.helpText}</div>}
          </div>
        </div>
      );
    case "sequence":
      return wrap(<SequenceField label={field.label} steps={field.steps ?? []} value={Array.isArray(value) ? (value as string[]) : []} disabled={locked} onChange={(v) => onChange(k, v)} />);
    case "matrix":
      return wrap(<MatrixField label={field.label} rows={field.rows ?? []} cols={field.cols ?? []} disabledCells={field.disabledCells} value={value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, boolean>) : {}} disabled={locked} onChange={(v) => onChange(k, v)} />);
    case "image":
      return wrap(
        <PhotoField
          label={field.label}
          fieldKey={k}
          value={Array.isArray(value) ? (value as ImageValue[]) : []}
          maxCount={field.maxCount ?? 1}
          capture={field.capture}
          required={field.required}
          disabled={locked}
          target={photoTarget ?? null}
          onChange={(v) => onChange(k, v)}
          onPendingChange={(ids) => onPendingPhotos?.(k, ids)}
        />
      );
    case "teamPicker":
      // A team picker with a key of its own sits in a per-team group (the match's own team picker is rendered by <ScoutForm/> itself).
      return wrap(<TeamSelect id={id} label={field.label} value={typeof value === "number" ? value : ""} teams={teams ?? []} disabled={locked} invalid={!!error} onChange={(t) => onChange(k, t)} />);
    case "checkbox":
      // Rendered in batched groups by renderFieldList below, never alone.
      return null;
    default:
      return null; // system fields are rendered by <ScoutForm/> itself
  }
}

type Block = { kind: "field"; field: FormField } | { kind: "tiles"; fields: FormField[] } | { kind: "half"; fields: FormField[] };

/** Groups a section's fields for layout, order-preserving: consecutive checkboxes into one tile row, consecutive "half width" fields (scout name, team picker) into a two-column grid, everything else on its own. */
function layoutBlocks(fields: FormField[]): Block[] {
  const blocks: Block[] = [];
  let tiles: FormField[] = [];
  let half: FormField[] = [];
  const flush = () => {
    if (tiles.length) blocks.push({ kind: "tiles", fields: tiles });
    if (half.length) blocks.push({ kind: "half", fields: half });
    tiles = [];
    half = [];
  };
  for (const f of fields) {
    if (f.type === "checkbox") {
      if (half.length) flush();
      tiles.push(f);
    } else if (f.type === "scoutName" || f.type === "teamPicker" || f.ui?.width === "half") {
      if (tiles.length) flush();
      half.push(f);
    } else {
      flush();
      blocks.push({ kind: "field", field: f });
    }
  }
  flush();
  return blocks;
}

function matchLabel(assigned: AssignedMatch) {
  return `${assigned.type} ${MATCH_TYPE_PREFIX[assigned.type]}${assigned.match.matchNumber}`;
}

export const ScoutForm = forwardRef<ScoutFormHandle, ScoutFormProps>(function ScoutForm(
  {
    schema = BIOBUZZ_FORM,
    mode,
    activeEvent = null,
    eventChoices = [],
    onEventChange,
    prefill,
    lockedFields = [],
    hideMatchPicker = false,
    showSubmitButton = true,
    layout = "page",
    onChange,
    onSubmit,
    commentsMode,
    comments,
    onCommentsChange,
    draftUserId,
    lockout,
    teamMarks,
    myTeamFor,
    pit,
    matchPickerMarks,
    subInControl,
  },
  ref
) {
  const [assignedMatch, setAssignedMatch] = useState<AssignedMatch | null>(prefill?.match ?? null);
  const [teamNumber, setTeamNumber] = useState<number | null>(prefill?.teamNumber ?? null);
  const commentsField = useMemo(() => fieldWithRole(schema, "comments"), [schema]);
  const popout = (commentsMode ?? (layout === "side-panel" ? "popout" : "inline")) === "popout" && !!commentsField && !!onCommentsChange;
  const [rawValues, setValues] = useState<FormValues>(() => ({ ...defaultValues(schema), ...prefill?.values, ...(commentsField && comments !== undefined ? { [commentsField.key]: comments } : {}) } as FormValues));
  // In popout mode the comments text is the caller's (the drawer edits it), so it overrides whatever the form holds for that field.
  const values = useMemo<FormValues>(() => (popout && commentsField ? { ...rawValues, [commentsField.key]: comments ?? "" } : rawValues), [rawValues, popout, commentsField, comments]);

  const [matchDialogOpen, setMatchDialogOpen] = useState(false);
  const [teamDialogOpen, setTeamDialogOpen] = useState(false);
  /** Which "Submit anyway?" question is open (CS asked them with window.confirm, one after the other). */
  const [confirming, setConfirming] = useState<"duplicate" | "pit" | null>(null);
  /** The team whose pit numbers already filled the sliders (so a live pit update or a re-render does not overwrite the scout's own changes). */
  const pitAppliedFor = useRef<number | null>(null);
  const [validation, setValidation] = useState<{ match?: boolean; team?: boolean }>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [justSubmitted, setJustSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  /** A submit the browser is holding for the server (offline or slow): the entry is safe on this device and the connection chip shows it as pending. */
  const [queuedOffline, setQueuedOffline] = useState(false);
  /** A draft found on this device, offered to the scout ("Restore draft?"). */
  const [draftOffer, setDraftOffer] = useState<Draft<AssignedMatch> | null>(null);
  const dismissedDrafts = useRef(new Set<string>());
  const submittingRef = useRef(false);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);

  const scoutName = prefill?.scoutName ?? "";
  const isLocked = (key: string) => lockedFields.includes(key);

  // Re-applies prefill when the *identifying* values actually change (a new
  // match/team/scout to prefill as), not on every re-render — a reference
  // change in `prefill` alone (e.g. the parent recreating the object) would
  // otherwise clobber in-progress edits.
  useEffect(() => {
    if (prefill?.match !== undefined) {
      setAssignedMatch(prefill.match);
    }
  }, [prefill?.match?.type, prefill?.match?.match.matchNumber, prefill?.match]);
  useEffect(() => {
    if (prefill?.teamNumber !== undefined) {
      setTeamNumber(prefill.teamNumber);
    }
  }, [prefill?.teamNumber]);

  const handleEventChange = (code: string) => {
    const next = eventChoices.find((e) => e.code === code);
    if (!next || next.code === activeEvent?.code) return;
    // The picked match and team belong to the previous event's schedule/roster.
    setAssignedMatch(null);
    setTeamNumber(null);
    setValidation({});
    onEventChange?.(next);
  };

  const reset = () => {
    setAssignedMatch(prefill?.match ?? null);
    setTeamNumber(prefill?.teamNumber ?? null);
    setValues({ ...defaultValues(schema), ...prefill?.values } as FormValues);
    if (popout) onCommentsChange?.(typeof prefill?.values?.[commentsField!.key] === "string" ? (prefill.values[commentsField!.key] as string) : "");
    setValidation({});
    setFieldErrors({});
    pitAppliedFor.current = null;
  };

  const score = useMemo(() => calculateScore(schema, values), [schema, values]);
  const visible = useMemo(() => visibleFieldKeys(schema, values), [schema, values]);
  const currentValues = (): ScoutFormValues => ({ values, teamNumber, match: assignedMatch, scoutName });

  useEffect(() => {
    onChange?.(currentValues(), score);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, teamNumber, assignedMatch]);

  // --- draft protection: autosave to this device, offer to restore, clear on submit ---
  const latest = useRef({ values, teamNumber, assignedMatch });
  useEffect(() => {
    latest.current = { values, teamNumber, assignedMatch };
  }, [values, teamNumber, assignedMatch]);
  const matchKey = matchKeyOf(assignedMatch);

  const flushDraft = useCallback(() => {
    if (!draftUserId || submittingRef.current) return;
    const storage = browserDraftStorage();
    const now = latest.current;
    if (!storage || !hasProgress(schema, now.values)) return;
    saveDraft<AssignedMatch>(storage, { uid: draftUserId, formId: schema.id }, { match: now.assignedMatch, teamNumber: now.teamNumber, values: now.values }, matchKeyOf(now.assignedMatch));
  }, [draftUserId, schema]);

  useEffect(() => {
    if (!draftUserId) return;
    const timer = setTimeout(flushDraft, DRAFT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draftUserId, flushDraft, values, teamNumber, assignedMatch]);

  useEffect(() => {
    if (!draftUserId) return;
    // a tab that is closed or backgrounded can't wait for the debounce
    const onHide = () => {
      if (document.visibilityState === "hidden") flushDraft();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flushDraft);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flushDraft);
    };
  }, [draftUserId, flushDraft]);

  // Offer a stored draft: the one for the picked match + team, else (before both are picked) the latest one, e.g. after a reload.
  useEffect(() => {
    if (!draftUserId) return;
    const storage = browserDraftStorage();
    if (!storage) return;
    const found =
      matchKey !== null && teamNumber !== null
        ? loadDraft<AssignedMatch>(storage, { uid: draftUserId, formId: schema.id, matchKey, teamNumber })
        : loadLastDraft<AssignedMatch>(storage, draftUserId, schema.id);
    const offer =
      found && hasProgress(schema, found.values) && !dismissedDrafts.current.has(String(found.savedAt)) && JSON.stringify(found.values) !== JSON.stringify(latest.current.values) ? found : null;
    // Deliberate: reads localStorage (an external system) when the picked match or team changes, then offers what it found.
    setDraftOffer(offer);
  }, [draftUserId, schema, matchKey, teamNumber]);

  const restoreDraft = () => {
    if (!draftOffer) return;
    dismissedDrafts.current.add(String(draftOffer.savedAt));
    const restored = normalizeValues(schema, draftOffer.values as Record<string, unknown>);
    setAssignedMatch(draftOffer.match);
    setTeamNumber(draftOffer.teamNumber);
    // the draft's own scale answers win over the pit numbers
    pitAppliedFor.current = draftOffer.teamNumber;
    setValues(restored);
    if (popout && commentsField) onCommentsChange?.(typeof restored[commentsField.key] === "string" ? (restored[commentsField.key] as string) : "");
    setFieldErrors({});
    setValidation({});
    setDraftOffer(null);
  };

  const discardDraft = () => {
    if (!draftOffer || !draftUserId) return;
    dismissedDrafts.current.add(String(draftOffer.savedAt));
    const storage = browserDraftStorage();
    if (storage) clearDraft(storage, { uid: draftUserId, formId: schema.id, matchKey: matchKeyOf(draftOffer.match), teamNumber: draftOffer.teamNumber });
    setDraftOffer(null);
  };

  // --- CS pit-sync: prefill the scales from the picked team's pit entry, once per team ---
  const pitValues = pit && teamNumber !== null ? pit.forTeam(teamNumber) : null;
  const pitPrefillKey = pitValues ? JSON.stringify(pitValues) : null;
  useEffect(() => {
    if (teamNumber === null) {
      pitAppliedFor.current = null;
      return;
    }
    if (!pitValues) {
      // another team without pit numbers: picking the first one again later fills its sliders again, as CS did on every pick
      if (pit?.loaded && pitAppliedFor.current !== teamNumber) pitAppliedFor.current = null;
      return;
    }
    if (pitAppliedFor.current === teamNumber) return;
    pitAppliedFor.current = teamNumber;
    const patch = pitPrefill(pitValues);
    // Deliberate: the pit entry is external data that arrives after the team is picked; it fills the sliders once.
    setValues((v) => ({ ...v, ...patch }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamNumber, pitPrefillKey]);
  const pitWarnings = useMemo(() => pitMismatchMessages(pitValues, values), [pitValues, values]);
  const pitSynced = pitValues !== null;
  const matchMarks = useMemo(() => teamMarks?.(assignedMatch) ?? null, [teamMarks, assignedMatch]);
  const alreadyScouted = teamNumber !== null && matchMarks?.get(teamNumber) === "scouted";
  const locked = !!lockout?.locked;

  const runValidation = () => {
    const missingMatch = !hideMatchPicker && !assignedMatch;
    const missingTeam = teamNumber === null;
    const errors = validateValues(schema, values);
    setValidation({ match: missingMatch, team: missingTeam });
    setFieldErrors(errors);
    return !missingMatch && !missingTeam && Object.keys(errors).length === 0;
  };

  useImperativeHandle(ref, () => ({
    validate: runValidation,
    getValues: currentValues,
    reset,
  }));

  /** The sections a scout sees: visible ones with something to show (the picker section vanishes when the match picker is hidden). */
  const renderedSections = useMemo(() => {
    const out: { section: FormSection; fields: FormField[] }[] = [];
    for (const section of schema.sections) {
      if (!section.visible) continue;
      const fields = section.fields.filter((f) => {
        if (f.type === "matchPicker") return !hideMatchPicker;
        if (isSystemField(f)) return true;
        if (popout && commentsField && f.key === commentsField.key) return false;
        return visible.has(f.key);
      });
      if (fields.length > 0) out.push({ section, fields });
    }
    return out;
  }, [schema, visible, hideMatchPicker, popout, commentsField]);

  useEffect(() => {
    if (layout !== "page") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const intersecting = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (intersecting[0]) setActiveSectionId(intersecting[0].target.id);
      },
      { rootMargin: "-120px 0px -55% 0px", threshold: [0, 0.25, 0.5, 0.75, 1] }
    );
    renderedSections.forEach(({ section }) => {
      const el = document.getElementById(section.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [layout, renderedSections]);

  const setFieldValue = (key: string, value: FormValue) => {
    if (popout && commentsField && key === commentsField.key) {
      onCommentsChange?.(String(value));
      return;
    }
    setValues((v) => ({ ...v, [key]: value }));
    setFieldErrors((e) => {
      if (!(key in e)) return e;
      const { [key]: _removed, ...rest } = e;
      void _removed;
      return rest;
    });
  };

  /** CS: picking a match you are assigned to (or took as a sub-in) fills in your robot. */
  const selectMatch = (m: AssignedMatch) => {
    setAssignedMatch(m);
    const mine = myTeamFor?.(m) ?? null;
    if (mine !== null) setTeamNumber(mine);
  };

  /** CS order: lockout, validation, "already scouted" confirm, pit-mismatch confirm, then save. */
  const handleSubmit = (acknowledged: { duplicate?: boolean; pit?: boolean } = {}) => {
    if (locked) return;
    if (!runValidation()) {
      // Scroll to the first problem: the match picker, else the team, else the first field with an error.
      const firstErrorKey = Object.keys(validateValues(schema, values))[0];
      const target = !hideMatchPicker && !assignedMatch ? document.getElementById(schema.sections.find((s) => s.fields.some((f) => f.type === "matchPicker"))?.id ?? "") : teamNumber === null ? document.getElementById(schema.sections.find((s) => s.fields.some((f) => f.type === "teamPicker"))?.id ?? "") : firstErrorKey ? document.querySelector(`[data-field-key="${firstErrorKey}"]`) : null;
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (!acknowledged.duplicate && alreadyScouted) {
      setConfirming("duplicate");
      return;
    }
    if (!acknowledged.pit && pitWarnings.length > 0) {
      setConfirming("pit");
      return;
    }
    void commitSubmit();
  };

  const commitSubmit = async () => {
    setSubmitting(true);
    submittingRef.current = true;
    const snapshot = currentValues();
    const draftIdentity = draftUserId ? { uid: draftUserId, formId: schema.id, matchKey: matchKeyOf(snapshot.match), teamNumber: snapshot.teamNumber } : null;
    try {
      // Offline, Firestore keeps the write in its local queue and the promise never settles: don't hold the form on "Submitting..." for that.
      const { outcome, settled } = await settleSubmit(onSubmit?.(snapshot, score), { isOffline: () => typeof navigator !== "undefined" && !navigator.onLine });
      const storage = draftIdentity ? browserDraftStorage() : null;
      if (storage && draftIdentity) clearDraft(storage, draftIdentity);
      if (outcome === "queued") {
        setQueuedOffline(true);
        settled.then(
          () => setQueuedOffline(false),
          () => {
            // The server refused a write we had called saved: put the work back in the draft so it isn't lost (the parent shows its own error).
            setQueuedOffline(false);
            if (storage && draftUserId) saveDraft<AssignedMatch>(storage, { uid: draftUserId, formId: schema.id }, { match: snapshot.match, teamNumber: snapshot.teamNumber, values: snapshot.values }, matchKeyOf(snapshot.match));
          }
        );
      }
      setJustSubmitted(true);
      setTimeout(() => setJustSubmitted(false), 2200);
      reset();
    } catch {
      // The parent's onSubmit is responsible for surfacing its own error UI.
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const sections: ScoutSection[] = renderedSections.map(({ section }) => ({ id: section.id, label: section.title }));
  const compact = layout === "side-panel";

  const scorePhases = useMemo(() => {
    const extra = Object.entries(score.byPhase).filter(([phase]) => phase !== "auto" && phase !== "teleop" && phase !== "endgame");
    if (extra.length === 0) return undefined;
    return [
      { label: "Auto", value: score.auto },
      { label: "Teleop", value: score.teleop },
      { label: "Endgame", value: score.endgame },
      ...extra.map(([phase, value]) => ({ label: phaseLabel(schema, phase), value })),
    ];
  }, [score, schema]);

  const renderMatchPicker = (field: FormField) => (
    <div key={field.id} className="flex flex-col gap-4">
      {eventChoices.length > 1 && (
        <div className="sm:max-w-sm">
          <Label htmlFor="scout-event-picker">Event</Label>
          <Select value={activeEvent?.code ?? ""} onValueChange={handleEventChange} disabled={isLocked("match")}>
            <SelectTrigger id="scout-event-picker">
              <SelectValue>{activeEvent?.name ?? "Pick an event"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {eventChoices.map((e) => (
                <SelectItem key={e.code} value={e.code}>
                  {e.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        <Button size="lg" className="gap-2" disabled={isLocked("match")} onClick={() => setMatchDialogOpen(true)}>
          {assignedMatch ? matchLabel(assignedMatch) : "Pick match"}
        </Button>
        {!isLocked("match") && subInControl}
      </div>
      {validation.match && <p className="text-sm font-medium text-red-300">Select a match before submitting.</p>}
      {assignedMatch && (
        <div className="glass-card flex flex-wrap items-center gap-3 p-4 text-sm">
          <Badge variant="accent">{matchLabel(assignedMatch)}</Badge>
          <span className="text-red-300">{assignedMatch.match.redTeams.join(", ") || "TBD"}</span>
          <span className="text-[var(--muted-foreground)]">vs</span>
          <span className="text-blue-300">{assignedMatch.match.blueTeams.join(", ") || "TBD"}</span>
        </div>
      )}
    </div>
  );

  const renderSystemField = (field: FormField) => {
    if (field.type === "matchPicker") return renderMatchPicker(field);
    if (field.type === "scoutName") {
      return (
        <div key={field.id}>
          <Label htmlFor="scout-name">{field.label || "Scout name"}</Label>
          <Input id="scout-name" value={scoutName} readOnly disabled className="text-[var(--muted-foreground)]" />
        </div>
      );
    }
    return (
      <div key={field.id}>
        <Label htmlFor="team-number-picker">{field.label || "Team number"}</Label>
        {!activeEvent && !isLocked("teamNumber") ? (
          <NoEventNotice />
        ) : (
          <Button
            id="team-number-picker"
            size="lg"
            variant={teamNumber ? "primary" : "glass"}
            className={cn("w-full", validation.team && "ring-2 ring-red-400")}
            disabled={isLocked("teamNumber")}
            onClick={() => setTeamDialogOpen(true)}
          >
            {teamNumber ? `Team ${teamNumber}` : "Pick team"}
          </Button>
        )}
        {validation.team && <p className="mt-1 text-sm font-medium text-red-300">Select a team before submitting.</p>}
        {alreadyScouted && (
          <p role="status" data-testid="already-scouted-note" className="mt-2 text-xs font-medium text-amber-300">
            Team {teamNumber} is already scouted for this match.
          </p>
        )}
        {pit && teamNumber !== null && (
          <div className="mt-2 flex flex-col gap-2" data-testid="pit-sync">
            <p role="status" className={cn("text-xs", pitSynced ? "text-emerald-300" : "text-[var(--muted-foreground)]")}>
              {!pit.loaded ? "Checking for a pit scout entry…" : pitSynced ? "Pit scout entry found for this team and event: the scales were filled from it." : "No pit scout entry synced for this team in this event yet."}
            </p>
            {pitWarnings.length > 0 && (
              <div role="alert" data-testid="pit-mismatch" className="flex items-start gap-2 rounded-2xl border border-red-400/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <div>
                  <p className="font-semibold">Match scout scales do not match the pit scout values for this team.</p>
                  {pitWarnings.map((message) => (
                    <p key={message}>{message}</p>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderField = (field: FormField) =>
    isSystemField(field) ? (
      renderSystemField(field)
    ) : (
      <RenderedField key={field.id} form={schema} field={field} value={values[field.key]} locked={isLocked(field.key)} error={fieldErrors[field.key]} onChange={setFieldValue} />
    );

  const renderBlocks = (fields: FormField[]): ReactNode[] =>
    layoutBlocks(fields).map((block, i) => {
      if (block.kind === "field") return renderField(block.field);
      if (block.kind === "half") {
        return (
          <div key={`half-${i}`} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {block.fields.map(renderField)}
          </div>
        );
      }
      return (
        <div key={`tiles-${i}`} className="flex flex-wrap gap-2">
          {block.fields.map((f) => (
            <span key={f.id} className="inline-flex items-center">
              <CheckboxTile label={f.label} checked={Boolean(values[f.key])} disabled={isLocked(f.key)} size={f.ui?.size} icon={f.ui?.icon ? <FieldIcon name={f.ui.icon} /> : undefined} onChange={(v) => setFieldValue(f.key, v)} />
              {f.tip && <FieldTip label={f.label} tip={f.tip} />}
            </span>
          ))}
        </div>
      );
    });

  return (
    <div data-scout-form-mode={mode} className={cn("flex flex-col gap-4", compact ? "pb-2" : "pb-4")}>
      {lockout && <SubmissionLockoutBanner lockout={lockout} editAllowed={false} />}

      {draftOffer && (
        <GlassPanel role="region" aria-label="Unsaved draft found" data-testid="draft-banner" className="flex flex-wrap items-center gap-3 p-4">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">Restore draft?</div>
            <div className="text-xs text-[var(--muted-foreground)]">
              {draftOffer.match ? matchLabel(draftOffer.match) : "No match picked"}
              {draftOffer.teamNumber ? ` · Team ${draftOffer.teamNumber}` : ""} &middot; saved {draftAge(draftOffer.savedAt)}
            </div>
          </div>
          <Button size="lg" onClick={restoreDraft}>
            Restore
          </Button>
          <Button size="lg" variant="glass" onClick={discardDraft}>
            Discard
          </Button>
        </GlassPanel>
      )}

      {!compact && <SectionNav sections={sections} activeId={activeSectionId} />}

      {renderedSections.map(({ section, fields }) => {
        const groups = section.groups ?? [];
        const grouped = groups.map((g) => ({ group: g, fields: fields.filter((f) => f.groupId === g.id) })).filter((g) => g.fields.length > 0);
        const ungrouped = fields.filter((f) => !f.groupId || !groups.some((g) => g.id === f.groupId));
        const showFlagNote = fields.some((f) => f.type === "checkbox") && fields.every((f) => !f.scoring || f.scoring.mode === "none");
        return (
          <section key={section.id} id={section.id} className="scroll-mt-20">
            <GlassPanel className="flex flex-col gap-4" style={section.accent && section.accent !== "default" ? { borderLeft: `4px solid ${ACCENT_TOKENS[section.accent]}` } : undefined}>
              <h2 className={compact ? "glass-strong sticky top-0 z-10 -mx-2 -mt-2 rounded-xl px-3 py-2 text-base font-bold" : "text-lg font-bold"}>{section.title}</h2>
              {showFlagNote && <p className="text-xs text-[var(--muted-foreground)]">{FLAG_SECTION_NOTE}</p>}
              {renderBlocks(ungrouped)}
              {grouped.map(({ group, fields: groupFields }) => (
                <div key={group.id} className="flex flex-col gap-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">{group.title}</h3>
                  {renderBlocks(groupFields)}
                </div>
              ))}
            </GlassPanel>
          </section>
        );
      })}

      {showSubmitButton && (
        <Button size="lg" className="mt-1 gap-2 self-start" onClick={() => handleSubmit()} disabled={submitting || locked} data-testid="scout-submit">
          <Send className="h-4 w-4" /> {submitting ? "Submitting…" : "Submit match"}
        </Button>
      )}

      {schema.scoringEnabled && <ScoreBar score={score} phases={scorePhases} />}

      {!hideMatchPicker && (
        <MatchPickerDialog open={matchDialogOpen} onOpenChange={setMatchDialogOpen} activeEvent={activeEvent} onSelect={selectMatch} marks={matchPickerMarks} />
      )}

      {activeEvent && (
        <TeamPickerDialog
          open={teamDialogOpen}
          onOpenChange={setTeamDialogOpen}
          eventCode={activeEvent.code}
          season={activeEvent.season}
          priorityTeamNumbers={assignedMatch ? [...assignedMatch.match.redTeams, ...assignedMatch.match.blueTeams] : undefined}
          marks={matchMarks ?? undefined}
          highlightTeam={assignedMatch ? (myTeamFor?.(assignedMatch) ?? null) : null}
          onSelect={setTeamNumber}
        />
      )}

      <ConfirmDialog
        open={confirming === "duplicate"}
        onOpenChange={(o) => !o && setConfirming((c) => (c === "duplicate" ? null : c))}
        title="Already scouted"
        description="That robot has already been scouted for this match. Submit anyway?"
        confirmLabel="Submit anyway"
        onConfirm={() => handleSubmit({ duplicate: true })}
        testId="confirm-duplicate"
      />
      <ConfirmDialog
        open={confirming === "pit"}
        onOpenChange={(o) => !o && setConfirming((c) => (c === "pit" ? null : c))}
        title="Scales don't match the pit scout"
        description="Match scout scales do not match the synced pit scout values for this event. Submit anyway?"
        confirmLabel="Submit anyway"
        onConfirm={() => handleSubmit({ duplicate: true, pit: true })}
        testId="confirm-pit"
      >
        <ul className="list-disc space-y-1 pl-5 text-[var(--muted-foreground)]">
          {pitWarnings.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      </ConfirmDialog>

      <AnimatePresence>
        {(justSubmitted || queuedOffline) && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={springSnappy}
            className="glass-strong fixed bottom-[calc(6rem+env(safe-area-inset-bottom))] left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full px-5 py-3 text-sm font-medium shadow-2xl"
          >
            {queuedOffline ? (
              <>
                <CloudOff className="h-4 w-4 text-amber-300" />
                <span role="status">Saved on this device &mdash; syncs when you&apos;re back online.</span>
                <ConnectionChip connection={connectionNotice(typeof navigator !== "undefined" && !navigator.onLine, 1)} className="ml-1 px-2" />
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                Match logged &mdash; ready for the next one.
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

function NoEventNotice() {
  return (
    <div className="glass-card flex items-center justify-between gap-3 p-3 text-sm text-[var(--muted-foreground)]">
      <span className="flex items-center gap-2">
        <CalendarX2 className="h-4 w-4 shrink-0" /> No active event
      </span>
      <Link href="/event">
        <Button variant="glass" size="sm">
          Select event
        </Button>
      </Link>
    </div>
  );
}

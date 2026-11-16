"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { AchievementCard } from "@/components/achievements/achievement-card";
import { AchievementIcon } from "@/components/achievements/achievement-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Input, Textarea } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ApiError, authedApi } from "@/lib/api-client";
import { ACHIEVEMENT_LIMITS, EMPTY_ACHIEVEMENT_CONFIG, cleanText, effectiveAchievements, parseAchievementConfig, type AchievementConfig, type EffectiveAchievement } from "@/lib/achievements/config";
import { blankCustom, isDirty, moveAchievement, newCustomId, removeCustom, resetBuiltin, setBuiltinOverride, setCustomHidden, upsertCustom } from "@/lib/achievements/edit";
import type { AchievementDefinition } from "@/lib/achievements/engine";
import { METRICS, metricsForProgram, type MetricId } from "@/lib/achievements/metrics";
import { useProgram, useProgramConfig } from "@/lib/program/context";
import { SIDEBAR_ICON_KEYS } from "@/lib/sidebar/icons";
import { cn } from "@/lib/utils";

const iconButton = "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--glass-border)] text-[var(--foreground)] transition-colors hover:bg-white/8 disabled:cursor-not-allowed disabled:opacity-35 pointer-coarse:h-11 pointer-coarse:w-11";

/**
 * Admin Panel > Achievements: one editor for both programs. A team admin renames or hides the built-in achievements and makes its own from the
 * measures the app already computes (Admin Panel never stores progress: earned state is always computed, so removing or hiding one never breaks a profile).
 * Saved through the server route; a version check turns a clash with another admin into a message and "Load latest".
 */
export function AchievementsPanel() {
  const program = useProgram();
  const { achievementMetrics } = useProgramConfig();
  const available = useMemo(() => metricsForProgram(achievementMetrics), [achievementMetrics]);
  const [saved, setSaved] = useState<AchievementConfig | null>(null);
  const [draft, setDraft] = useState<AchievementConfig>(EMPTY_ACHIEVEMENT_CONFIG);
  const [canEdit, setCanEdit] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [editing, setEditing] = useState<{ def: AchievementDefinition; builtin: boolean; isNew: boolean } | null>(null);
  const [deleting, setDeleting] = useState<AchievementDefinition | null>(null);

  const [nonce, setNonce] = useState(0);
  /** Reads the latest settings again ("Try again", "Load latest"). */
  const load = useCallback(() => {
    setLoadError(null);
    setNonce((n) => n + 1);
  }, []);
  useEffect(() => {
    let cancelled = false;
    authedApi<{ config?: unknown; canEdit?: boolean }>(`/api/achievements/config?program=${encodeURIComponent(program)}`)
      .then((res) => {
        if (cancelled) return;
        const config = parseAchievementConfig(res.config);
        setSaved(config);
        setDraft(config);
        setCanEdit(res.canEdit === true);
        setConflict(false);
        setSaveError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Couldn't load the achievement settings.");
      });
    return () => {
      cancelled = true;
    };
  }, [program, nonce]);

  const rows = useMemo(() => effectiveAchievements(draft, achievementMetrics), [draft, achievementMetrics]);
  const dirty = saved ? isDirty(saved, draft) : false;
  const disabled = !canEdit || saving;

  const save = async () => {
    if (!saved) return;
    setSaving(true);
    setSaveError(null);
    setJustSaved(false);
    try {
      const res = await authedApi<{ config?: unknown }>("/api/achievements/config", {
        method: "PUT",
        body: { program, expectedVersion: saved.version, overrides: draft.overrides, custom: draft.custom, order: draft.order },
      });
      const config = parseAchievementConfig(res.config);
      setSaved(config);
      setDraft(config);
      setJustSaved(true);
    } catch (err) {
      if (err instanceof ApiError && err.code === "conflict") setConflict(true);
      else setSaveError(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  };

  if (loadError) {
    return (
      <GlassPanel role="alert" data-testid="achievements-panel-error" className="flex flex-col items-start gap-3 text-sm">
        <p className="text-red-400">{loadError}</p>
        <Button variant="outline" onClick={load}>
          Try again
        </Button>
      </GlassPanel>
    );
  }
  if (!saved) return <GlassPanel className="py-8 text-center text-sm text-[var(--muted-foreground)]">Loading achievements…</GlassPanel>;

  return (
    <div className="flex flex-col gap-4" data-testid="achievements-panel">
      <GlassPanel className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-xl text-sm text-[var(--muted-foreground)]">
            Rename or hide the built-in achievements and make your own from what the app already measures. Names and descriptions are plain text. Earned achievements are always
            worked out from scouting and practice data, so hiding or deleting one never changes anyone&apos;s history.
          </div>
          <Button
            className="min-h-11 gap-1.5"
            disabled={disabled || draft.custom.length >= ACHIEVEMENT_LIMITS.maxCustom || available.length === 0}
            onClick={() => setEditing({ def: blankCustom(available[0]), builtin: false, isNew: true })}
          >
            <Plus className="h-4 w-4" aria-hidden /> New achievement
          </Button>
        </div>
        {!canEdit && <p className="text-xs text-[var(--muted-foreground)]">Only team admins can change these. You are seeing them as they are.</p>}
        {conflict && (
          <div role="alert" data-testid="achievements-conflict" className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-400/40 bg-amber-500/10 p-3 text-sm">
            <span>Someone else saved changes while you were editing. Your edits were not saved.</span>
            <Button variant="outline" className="min-h-11" onClick={load}>
              Load latest
            </Button>
          </div>
        )}
        {saveError && (
          <p role="alert" className="text-sm text-red-400" data-testid="achievements-save-error">
            {saveError}
          </p>
        )}
        {justSaved && !dirty && (
          <p role="status" className="text-sm text-emerald-400" data-testid="achievements-saved">
            Saved.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button className="min-h-11" disabled={!dirty || disabled} onClick={() => void save()}>
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button variant="ghost" className="min-h-11" disabled={!dirty || saving} onClick={() => setDraft(saved)}>
            Discard changes
          </Button>
        </div>
      </GlassPanel>

      <ul className="flex flex-col gap-2" aria-label="Achievements" data-testid="achievements-list">
        {rows.map((row, i) => (
          <EditorRow
            key={row.def.id}
            row={row}
            first={i === 0}
            last={i === rows.length - 1}
            disabled={disabled}
            customized={!!draft.overrides[row.def.id]}
            onMove={(d) => setDraft((c) => moveAchievement(c, row.def.id, d))}
            onEdit={() => setEditing({ def: row.def, builtin: row.builtin, isNew: false })}
            onHidden={(hidden) => setDraft((c) => (row.builtin ? setBuiltinOverride(c, row.def.id, { hidden }) : setCustomHidden(c, row.def.id, hidden)))}
            onReset={() => setDraft((c) => resetBuiltin(c, row.def.id))}
            onDelete={() => setDeleting(row.def)}
          />
        ))}
      </ul>

      {editing && (
        <EditDialog
          key={editing.def.id}
          initial={editing.def}
          builtin={editing.builtin}
          isNew={editing.isNew}
          available={available}
          onClose={() => setEditing(null)}
          onApply={(def) => {
            setDraft((c) => (editing.builtin ? setBuiltinOverride(c, def.id, { name: def.name, description: def.description }) : upsertCustom(c, def)));
            setEditing(null);
          }}
        />
      )}

      <Dialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="glass-overlay w-[min(94vw,420px)]">
          <DialogTitle>Delete {deleting?.name}?</DialogTitle>
          <DialogDescription>It disappears from the Achievements page and from profiles. Nobody&apos;s data changes. Nothing is saved until you press Save.</DialogDescription>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" className="min-h-11" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              className="min-h-11"
              onClick={() => {
                if (deleting) setDraft((c) => removeCustom(c, deleting.id));
                setDeleting(null);
              }}
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EditorRow({
  row,
  first,
  last,
  disabled,
  customized,
  onMove,
  onEdit,
  onHidden,
  onReset,
  onDelete,
}: {
  row: EffectiveAchievement;
  first: boolean;
  last: boolean;
  disabled: boolean;
  customized: boolean;
  onMove: (delta: -1 | 1) => void;
  onEdit: () => void;
  onHidden: (hidden: boolean) => void;
  onReset: () => void;
  onDelete: () => void;
}) {
  const { def } = row;
  const metric = Object.hasOwn(METRICS, def.metric) ? METRICS[def.metric] : null;
  return (
    <li data-testid={`editor-row-${def.id}`} className={cn("glass-card flex flex-wrap items-center gap-3 p-3", row.hidden && "opacity-60")}>
      <AchievementIcon name={def.icon} className="h-5 w-5 shrink-0 text-[var(--muted-foreground)]" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{def.name}</span>
          <Badge variant="glass" className="text-[10px]">
            {row.builtin ? "Built-in" : "Custom"}
          </Badge>
          {row.unavailable && (
            <Badge variant="outline" className="text-[10px]" data-testid={`unavailable-${def.id}`}>
              Unavailable
            </Badge>
          )}
          {row.hidden && (
            <Badge variant="outline" className="text-[10px]">
              Hidden
            </Badge>
          )}
        </div>
        <p className="truncate text-xs text-[var(--muted-foreground)]">
          {row.unavailable ? "This measure is not available any more, so it is skipped on every page." : `${metric?.label ?? def.metric}: ${def.threshold} ${metric?.unit ?? ""}${def.scope === "season" ? " this season" : ""}`}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className={iconButton} aria-label={`Move ${def.name} up`} disabled={disabled || first} onClick={() => onMove(-1)}>
          <ArrowUp className="h-4 w-4" aria-hidden />
        </button>
        <button type="button" className={iconButton} aria-label={`Move ${def.name} down`} disabled={disabled || last} onClick={() => onMove(1)}>
          <ArrowDown className="h-4 w-4" aria-hidden />
        </button>
        <button type="button" className={iconButton} aria-label={`Edit ${def.name}`} disabled={disabled} onClick={onEdit}>
          <Pencil className="h-4 w-4" aria-hidden />
        </button>
        {row.builtin && (
          <button type="button" className={iconButton} aria-label={`Reset ${def.name} to its default`} disabled={disabled || !customized} onClick={onReset}>
            <RotateCcw className="h-4 w-4" aria-hidden />
          </button>
        )}
        {!row.builtin && (
          <button type="button" className={iconButton} aria-label={`Delete ${def.name}`} disabled={disabled} onClick={onDelete}>
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        )}
        <Switch checked={!row.hidden} onCheckedChange={(shown) => onHidden(!shown)} disabled={disabled} aria-label={`Show ${def.name}`} />
      </div>
    </li>
  );
}

const FIELD = "flex flex-col gap-1 text-xs text-[var(--muted-foreground)]";

function EditDialog({
  initial,
  builtin,
  isNew,
  available,
  onClose,
  onApply,
}: {
  initial: AchievementDefinition;
  builtin: boolean;
  isNew: boolean;
  available: MetricId[];
  onClose: () => void;
  onApply: (def: AchievementDefinition) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [icon, setIcon] = useState(initial.icon);
  const [metric, setMetric] = useState<MetricId>(initial.metric);
  const [thresholdText, setThresholdText] = useState(String(initial.threshold));
  const [scope, setScope] = useState(initial.scope);
  const [minSamplesText, setMinSamplesText] = useState(String(initial.minSamples ?? 1));

  const def = Object.hasOwn(METRICS, metric) ? METRICS[metric] : null;
  const threshold = Number(thresholdText);
  const minSamples = Number(minSamplesText);
  const cleanName = cleanText(name, ACHIEVEMENT_LIMITS.nameMax);
  const cleanDescription = cleanText(description, ACHIEVEMENT_LIMITS.descriptionMax);
  const thresholdOk = Number.isInteger(threshold) && threshold >= ACHIEVEMENT_LIMITS.thresholdMin && threshold <= ACHIEVEMENT_LIMITS.thresholdMax;
  const samplesOk = !def?.usesSamples || (Number.isInteger(minSamples) && minSamples >= 1 && minSamples <= ACHIEVEMENT_LIMITS.minSamplesMax);
  const valid = cleanName !== null && cleanDescription !== null && (builtin || (thresholdOk && samplesOk && !!def));
  const effectiveScope = def?.seasonScope ? scope : "all";

  const candidate: AchievementDefinition = {
    ...initial,
    id: initial.id || newCustomId(),
    name: cleanName ?? name,
    description: cleanDescription ?? description,
    icon,
    metric,
    threshold: thresholdOk ? threshold : initial.threshold,
    scope: effectiveScope,
    ...(def?.usesSamples && samplesOk ? { minSamples } : {}),
  };
  // The live preview: how the card looks for someone 60% of the way there.
  const previewTarget = Math.max(1, candidate.threshold);
  const preview = { current: Math.floor(previewTarget * 0.6), target: previewTarget, ratio: Math.floor(previewTarget * 0.6) / previewTarget, earned: false, noData: false };
  const nameError = cleanName === null ? `Required: plain text, up to ${ACHIEVEMENT_LIMITS.nameMax} characters, no < or >.` : null;
  const descriptionError = cleanDescription === null ? `Required: plain text, up to ${ACHIEVEMENT_LIMITS.descriptionMax} characters, no < or >.` : null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="glass-overlay max-h-[90dvh] w-[min(94vw,520px)] overflow-y-auto">
        <DialogTitle>{isNew ? "New achievement" : builtin ? `Edit ${initial.name}` : `Edit ${initial.name || "achievement"}`}</DialogTitle>
        <DialogDescription>
          {builtin ? "You can rename a built-in achievement and change its description. Its goal stays as it is." : "Pick what to measure and the number to reach. Progress is worked out from data the app already has."}
        </DialogDescription>
        <div className="mt-4 flex flex-col gap-3">
          <label className={FIELD}>
            Name
            <Input value={name} maxLength={ACHIEVEMENT_LIMITS.nameMax} onChange={(e) => setName(e.target.value)} aria-invalid={nameError !== null} data-testid="achievement-name" />
            {nameError && <span className="text-red-400">{nameError}</span>}
          </label>
          <label className={FIELD}>
            Description
            <Textarea rows={2} value={description} maxLength={ACHIEVEMENT_LIMITS.descriptionMax} onChange={(e) => setDescription(e.target.value)} aria-invalid={descriptionError !== null} data-testid="achievement-description" />
            {descriptionError && <span className="text-red-400">{descriptionError}</span>}
          </label>
          {!builtin && (
            <>
              <div className={FIELD}>
                <span id="achievement-icon-label">Icon</span>
                <Select value={icon} onValueChange={setIcon}>
                  <SelectTrigger aria-labelledby="achievement-icon-label">
                    <SelectValue>
                      <span className="inline-flex items-center gap-2">
                        <AchievementIcon name={icon} className="h-4 w-4" /> {icon}
                      </span>
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {SIDEBAR_ICON_KEYS.map((key) => (
                      <SelectItem key={key} value={key}>
                        <span className="inline-flex items-center gap-2">
                          <AchievementIcon name={key} className="h-4 w-4" /> {key}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className={FIELD}>
                <span id="achievement-metric-label">Measures</span>
                <Select value={metric} onValueChange={(v) => setMetric(v as MetricId)}>
                  <SelectTrigger aria-labelledby="achievement-metric-label">
                    <SelectValue>{def ? `${def.label} (${def.unit})` : "Unavailable"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {available.map((id) => (
                      <SelectItem key={id} value={id}>
                        {METRICS[id].label} ({METRICS[id].unit})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {def && <span>{def.help}</span>}
                {!def && <span className="text-red-400">This measure no longer exists. Pick another one, or delete this achievement.</span>}
              </div>
              <label className={FIELD}>
                Goal{def ? ` (${def.unit})` : ""}
                <Input inputMode="numeric" value={thresholdText} onChange={(e) => setThresholdText(e.target.value)} aria-invalid={!thresholdOk} data-testid="achievement-threshold" />
                {!thresholdOk && <span className="text-red-400">A whole number from {ACHIEVEMENT_LIMITS.thresholdMin} to {ACHIEVEMENT_LIMITS.thresholdMax}.</span>}
              </label>
              {def?.seasonScope && (
                <div className={FIELD}>
                  <span id="achievement-scope-label">Counts</span>
                  <Select value={scope} onValueChange={(v) => setScope(v as "all" | "season")}>
                    <SelectTrigger aria-labelledby="achievement-scope-label">
                      <SelectValue>{scope === "season" ? "This season only" : "All time"}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All time</SelectItem>
                      <SelectItem value="season">This season only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              {def?.usesSamples && (
                <label className={FIELD}>
                  Minimum sessions before it counts
                  <Input inputMode="numeric" value={minSamplesText} onChange={(e) => setMinSamplesText(e.target.value)} aria-invalid={!samplesOk} />
                  {!samplesOk && <span className="text-red-400">A whole number from 1 to {ACHIEVEMENT_LIMITS.minSamplesMax}.</span>}
                </label>
              )}
            </>
          )}
          <div className="flex flex-col gap-1 text-xs text-[var(--muted-foreground)]">
            <span>Preview (as it looks at 60%)</span>
            <ul>
              <AchievementCard def={{ ...candidate, name: candidate.name || "Name", description: candidate.description || "Description" }} progress={preview} earned={false} />
            </ul>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" className="min-h-11" onClick={onClose}>
            Cancel
          </Button>
          <Button className="min-h-11" disabled={!valid} onClick={() => onApply(candidate)} data-testid="achievement-apply">
            Apply
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

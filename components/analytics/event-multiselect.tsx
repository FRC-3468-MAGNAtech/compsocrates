"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { FloatingPanel } from "@/components/ui/floating-panel";
import { OptionCheck } from "@/components/ui/select";
import { Check, ChevronDown, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { STATUS_BADGE } from "@/components/event/selected-events-panel";
import type { EventOption } from "@/lib/analytics/data-context";
import type { EventScope } from "@/lib/analytics/filters";
import { getEventStatus } from "@/lib/events/event-status";
import { eventLabel, eventTitleInSeason, withEventYear } from "@/lib/events/names";
import { springSnappy } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** Same event? Picked codes come back from the URL upper-cased, so codes are compared that way everywhere in this control. */
const sameCode = (a: string, b: string) => a.toUpperCase() === b.toUpperCase();

export const NO_GAME_CONFIG_LABEL = "No game config yet";

/** An event's title with its year: from the key when the key has a season, else from the event's own season in the program's wording. */
export const optionTitle = (o: Pick<EventOption, "code" | "name" | "season">, seasonKind: "calendar" | "start-year") => eventTitleInSeason(o, o.season, seasonKind);

/**
 * The Analytics Event control: a multi-select with two presets ("Active
 * events", the default, and "All events") above the individual events. In
 * single-event mode it is a plain single select (the selected row carries the
 * same check as every other select, `OptionCheck`). The list is a floating
 * panel, so it uses `.glass-overlay` (solid backing) like every other dropdown.
 * Keyboard: the arrow keys, Home and End move between rows, Enter or Space picks.
 */
export function EventMultiSelect({
  options,
  scope,
  onChange,
  singleEvent,
  practice,
  primaryCode,
  singleSelectedCode,
  showArchived,
  onShowArchivedChange,
  hasArchived,
  seasonKind,
}: {
  options: EventOption[];
  scope: EventScope;
  onChange: (scope: EventScope) => void;
  singleEvent: boolean;
  practice: boolean;
  primaryCode: string | null;
  /** Single-event mode only: the event the page is actually showing (its resolved default when nothing was picked). */
  singleSelectedCode: string | null;
  /** "Show archived events": archived events are listed, and All Events counts them, only while on. */
  showArchived: boolean;
  onShowArchivedChange: (value: boolean) => void;
  /** The team has at least one archived event (the switch is hidden otherwise). */
  hasArchived: boolean;
  /** How the program words a season next to a name (`ProgramConfig.event.seasonKind`). */
  seasonKind: "calendar" | "start-year";
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const now = useNow();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      // The list is portaled (FloatingPanel), so it is not inside rootRef.
      if (rootRef.current && !rootRef.current.contains(t) && !panelRef.current?.contains(t)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Move focus into the list when it opens: the selected row, else the first one.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const rows = panelRef.current?.querySelectorAll<HTMLElement>('[role="option"]');
      const target = panelRef.current?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]') ?? rows?.[0];
      target?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const customCodes = scope.kind === "custom" ? scope.codes : [];
  const selectedCodes = singleEvent ? (singleSelectedCode ? [singleSelectedCode] : []) : customCodes;
  const isSelected = (code: string) => selectedCodes.some((c) => sameCode(c, code));
  const nameOf = (code: string) => {
    const option = options.find((o) => sameCode(o.code, code));
    return option ? optionTitle(option, seasonKind) : withEventYear(eventLabel({ key: code }), code);
  };

  const summary = singleEvent
    ? singleSelectedCode
      ? nameOf(singleSelectedCode)
      : "Pick an event"
    : scope.kind === "all"
      ? "All events"
      : scope.kind === "active"
        ? practice
          ? "All events"
          : `Active events (${options.filter((o) => o.active).length})`
        : customCodes.length === 1
          ? nameOf(customCodes[0])
          : `${nameOf(customCodes[0])} +${customCodes.length - 1}`;

  const toggle = (code: string) => {
    if (singleEvent) {
      onChange({ kind: "custom", codes: [code] });
      setOpen(false);
      return;
    }
    const next = isSelected(code) ? customCodes.filter((c) => !sameCode(c, code)) : [...customCodes, code];
    // Unchecking the last event falls back to the default rather than an empty (match-nothing) selection.
    onChange(next.length === 0 ? { kind: "active" } : { kind: "custom", codes: next });
  };

  const onListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const rows = [...(panelRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
    const next = nextRowIndex(e.key, rows.findIndex((r) => r === document.activeElement), rows.length);
    if (next === null) return;
    e.preventDefault();
    rows[next]?.focus();
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-11 min-w-[14rem] max-w-full items-center justify-between gap-2 rounded-2xl border border-[var(--glass-border)] bg-white/5 px-4 text-sm outline-none transition-shadow duration-300 focus-visible:shadow-[0_0_0_3px_rgba(var(--glow),0.25)] data-[open=true]:shadow-[0_0_0_3px_rgba(var(--glow),0.25)]"
        data-open={open}
      >
        <span className="truncate" title={summary}>{summary}</span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={springSnappy} className="shrink-0">
          <ChevronDown className="h-4 w-4 text-[var(--muted-foreground)]" />
        </motion.span>
      </button>

      <FloatingPanel
        open={open}
        anchorRef={rootRef}
        panelRef={panelRef}
        role="listbox"
        aria-multiselectable={!singleEvent}
        aria-label="Events"
        onKeyDown={onListKeyDown}
        className="flex max-h-[min(24rem,60vh)] w-[min(26rem,calc(100vw-2rem))] flex-col gap-0.5 overflow-y-auto rounded-2xl p-1.5 shadow-2xl"
      >
            {!singleEvent && (
              <>
                {!practice && (
                  <PresetRow
                    label="Active events"
                    hint="The events the team has set active"
                    selected={scope.kind === "active"}
                    onClick={() => onChange({ kind: "active" })}
                  />
                )}
                <PresetRow
                  label="All events"
                  hint={practice ? "Every library and live event" : "Every event of this game's season"}
                  selected={scope.kind === "all" || (practice && scope.kind === "active")}
                  onClick={() => onChange({ kind: "all" })}
                />
                <div className="mx-2 my-1 border-t border-[var(--glass-border)]" />
              </>
            )}
            {singleEvent && <p className="px-3 py-1.5 text-[11px] text-[var(--muted-foreground)]">This page works on one event&apos;s schedule, so All events is not offered here.</p>}

            {options.length === 0 && <p className="px-3 py-4 text-center text-xs text-[var(--muted-foreground)]">No events with data yet.</p>}

            {options.map((o) => (
              <EventOptionRow
                key={o.code}
                option={o}
                checked={isSelected(o.code)}
                singleEvent={singleEvent}
                seasonKind={seasonKind}
                showStar={o.code === primaryCode && !practice}
                now={now}
                onClick={() => toggle(o.code)}
              />
            ))}

            {hasArchived && (
              <>
                <div className="mx-2 my-1 border-t border-[var(--glass-border)]" />
                <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-sm hover:bg-white/10">
                  <input type="checkbox" checked={showArchived} onChange={(e) => onShowArchivedChange(e.target.checked)} className="h-4 w-4 shrink-0 accent-[var(--color-primary)]" />
                  Show archived events
                </label>
              </>
            )}
      </FloatingPanel>
    </div>
  );
}

function PresetRow({ label, hint, selected, onClick }: { label: string; hint: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onClick}
      className="flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-left text-sm outline-none transition-colors hover:bg-white/10 focus-visible:bg-white/10"
    >
      <span
        className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full border", selected ? "border-transparent" : "border-[var(--glass-border)]")}
        style={selected ? { background: "var(--theme-gradient)" } : undefined}
      >
        {selected && <Check aria-hidden="true" className="h-3 w-3 text-[var(--color-primary-foreground)]" strokeWidth={3} />}
      </span>
      <span className="min-w-0">
        <span className="block font-medium">{label}</span>
        <span className="block text-[11px] text-[var(--muted-foreground)]">{hint}</span>
      </span>
    </button>
  );
}

/** Fixed at mount so every status chip in the list agrees and render stays pure. */
function useNow() {
  const [now] = useState(() => Date.now());
  return now;
}

/** The row to focus after `key` from row `at` of `count` rows (the arrow keys stop at the ends; Home and End jump); null for any other key. */
export function nextRowIndex(key: string, at: number, count: number): number | null {
  if (count <= 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowDown") return Math.min(count - 1, at + 1);
  if (key === "ArrowUp") return Math.max(0, at - 1);
  return null;
}

/** One event row of the list. Selected = `aria-selected` plus the shared check mark (single mode) or a checked box (multi mode). */
export function EventOptionRow({
  option: o,
  checked,
  singleEvent,
  seasonKind,
  showStar,
  now,
  onClick,
}: {
  option: EventOption;
  checked: boolean;
  singleEvent: boolean;
  seasonKind: "calendar" | "start-year";
  showStar: boolean;
  now: number;
  onClick: () => void;
}) {
  const status = o.event && !o.noGameConfig ? STATUS_BADGE[getEventStatus(o.event, now)] : null;
  return (
    <button
      type="button"
      role="option"
      aria-selected={checked}
      onClick={onClick}
      className="flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-left text-sm outline-none transition-colors hover:bg-white/10 focus-visible:bg-white/10"
    >
      {!singleEvent && (
        <span
          className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-md border", checked ? "border-transparent" : "border-[var(--glass-border)]")}
          style={checked ? { background: "var(--theme-gradient)" } : undefined}
        >
          {checked && <Check aria-hidden="true" data-option-check="" className="h-3 w-3 text-[var(--color-primary-foreground)]" strokeWidth={3} />}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          {showStar && <Star className="h-3 w-3 shrink-0 fill-current" style={{ color: "var(--color-primary)" }} />}
          <span className="truncate font-medium" title={optionTitle(o, seasonKind)}>{optionTitle(o, seasonKind)}</span>
        </span>
        <span className="block text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
          {o.code} &middot; {o.count} {o.count === 1 ? "entry" : "entries"}
          {o.archived ? " \u00b7 archived" : ""}
        </span>
      </span>
      {o.noGameConfig && (
        <Badge variant="outline" className="shrink-0 text-[10px]">
          {NO_GAME_CONFIG_LABEL}
        </Badge>
      )}
      {status && (
        <Badge variant={status.variant} className="shrink-0 text-[10px]">
          {status.label}
        </Badge>
      )}
      {singleEvent && checked && <OptionCheck />}
    </button>
  );
}

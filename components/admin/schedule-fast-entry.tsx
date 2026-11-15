"use client";

import { useMemo, useRef, useState } from "react";
import { FieldError, MATCH_TYPE_OPTIONS, WarningList, selectClass } from "@/components/admin/library/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MATCH_TYPE_PREFIX } from "@/lib/analytics/game-schema";
import { parseMatchType } from "@/lib/library/ids";
import { emptyRawScheduleMatch, nextScheduleMatchNumber, scheduleMatchLabel, scheduleMatchWarnings, validateRawScheduleMatch, type LibraryActor, type RawScheduleMatch } from "@/lib/library/schedule";
import type { LibraryEvent } from "@/lib/library/store";
import type { LibraryMatch } from "@/lib/match-library";
import type { ProgramData } from "@/lib/program/data";
import { slotLabel } from "@/config/alliance";
import { cn } from "@/lib/utils";

/**
 * Spreadsheet-like entry for typing a whole event, one match after another (as CE did it). Tab moves left to right through the row; Enter (or Save and add
 * next) saves it, bumps the match number, keeps the match type and puts the cursor back on the first team box. A typed match is published at once, like CE.
 */
export function ScheduleFastEntry({ event, eventMatches, actor, library, size }: { event: LibraryEvent; eventMatches: LibraryMatch[]; actor: LibraryActor; library: ProgramData["library"]; size: number }) {
  const start = (type: string, n: number): RawScheduleMatch => ({ ...emptyRawScheduleMatch(size), matchType: type, matchNumber: String(n) });
  const [raw, setRaw] = useState<RawScheduleMatch>(() => start("Q", nextScheduleMatchNumber(eventMatches, "Qualification")));
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const firstTeamRef = useRef<HTMLInputElement>(null);

  const result = useMemo(() => validateRawScheduleMatch(raw, size), [raw, size]);
  const warnings = useMemo(() => (result.ok ? scheduleMatchWarnings(result.match, { eventCode: event.eventCode, existing: eventMatches }) : []), [result, event.eventCode, eventMatches]);
  const type = parseMatchType(raw.matchType);

  const setTeam = (color: "red" | "blue", i: number, value: string) => setRaw((r) => ({ ...r, [color]: r[color].map((v, k) => (k === i ? value : v)) }));

  const submit = async () => {
    setShowErrors(true);
    setMessage(null);
    if (!result.ok) return;
    setBusy(true);
    try {
      await library.upsertMatches(actor, event, [result.match], { newPublished: true, newNeedsReview: false });
      const next = result.match.matchNumber + 1;
      setMessage({ kind: "ok", text: `Saved ${scheduleMatchLabel(result.match)}. Ready for ${MATCH_TYPE_PREFIX[result.match.matchType]}${next}.` });
      setRaw(start(MATCH_TYPE_PREFIX[result.match.matchType], next));
      setShowErrors(false);
      firstTeamRef.current?.focus();
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error && err.message ? `Couldn't save that match: ${err.message}` : "Couldn't save that match. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  };

  const label = "mb-1 block text-[10px] font-medium uppercase tracking-wide";
  const errorList = showErrors && !result.ok ? Object.entries(result.errors) : [];

  return (
    <form
      className="flex flex-col gap-3 rounded-2xl border border-[var(--glass-border)] bg-white/4 p-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Fast entry</h3>
        <p className="text-xs text-[var(--muted-foreground)]">Tab between boxes, Enter to save. Matches are published as you save them.</p>
      </div>
      <div className="overflow-x-auto pb-1">
        <div className="flex min-w-max items-end gap-2">
          <div className="w-28 shrink-0">
            <label htmlFor="fe-type" className={cn(label, "text-[var(--muted-foreground)]")}>
              Type
            </label>
            <select id="fe-type" className={cn(selectClass, "h-11 w-full text-xs")} value={type ? MATCH_TYPE_PREFIX[type] : ""} onChange={(e) => setRaw((r) => ({ ...r, matchType: e.target.value }))}>
              {MATCH_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="w-16 shrink-0">
            <label htmlFor="fe-number" className={cn(label, "text-[var(--muted-foreground)]")}>
              #
            </label>
            <Input id="fe-number" className="h-11 px-2.5 text-xs" inputMode="numeric" value={raw.matchNumber} onChange={(e) => setRaw((r) => ({ ...r, matchNumber: e.target.value }))} aria-invalid={showErrors && !result.ok && !!result.errors.matchNumber} />
          </div>
          {(["red", "blue"] as const).flatMap((color) =>
            raw[color].map((value, i) => (
              <div key={`${color}${i}`} className="w-20 shrink-0">
                <label htmlFor={`fe-${color}${i}`} className={cn(label, color === "red" ? "text-red-300" : "text-blue-300")}>
                  {slotLabel(`${color}${i + 1}`)}
                </label>
                <Input
                  id={`fe-${color}${i}`}
                  ref={color === "red" && i === 0 ? firstTeamRef : undefined}
                  className="h-11 px-2.5 text-xs"
                  inputMode="numeric"
                  value={value}
                  onChange={(e) => setTeam(color, i, e.target.value)}
                  aria-invalid={showErrors && !result.ok && !!result.errors[color]}
                />
              </div>
            ))
          )}
          <div className="w-52 shrink-0">
            <label htmlFor="fe-time" className={cn(label, "text-[var(--muted-foreground)]")}>
              Time (optional)
            </label>
            <Input id="fe-time" type="datetime-local" className="h-11 px-2.5 text-xs" value={raw.scheduledTime} onChange={(e) => setRaw((r) => ({ ...r, scheduledTime: e.target.value }))} />
          </div>
        </div>
      </div>
      {errorList.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {errorList.map(([field, text]) => (
            <li key={field}>
              <FieldError className="mt-0">{text}</FieldError>
            </li>
          ))}
        </ul>
      )}
      <WarningList warnings={warnings} />
      {message && (
        <p role={message.kind === "error" ? "alert" : "status"} className={cn("text-xs", message.kind === "ok" ? "text-emerald-300" : "text-red-300")}>
          {message.text}
        </p>
      )}
      <div>
        <Button type="submit" className="min-h-11" disabled={busy}>
          {busy ? "Saving…" : "Save and add next"}
        </Button>
      </div>
    </form>
  );
}

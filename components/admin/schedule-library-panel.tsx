"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, Download, Eye, EyeOff, Pencil, Plus, Trash2 } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Label } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/scout/confirm-dialog";
import { FieldError, selectClass } from "@/components/admin/library/shared";
import { OriginBadge } from "@/components/admin/library/manual-library-panel";
import { useAuth } from "@/lib/auth";
import { useProgramData } from "@/lib/program/data";
import { useLibraryEvents } from "@/lib/library/store";
import { useAllLibraryMatches, useLibraryMatches, type LibraryMatch } from "@/lib/match-library";
import { useProgramConfig } from "@/lib/program/context";
import {
  emptyRawScheduleMatch,
  publishedLabel,
  scheduleMatchLabel as matchLabel,
  summarizeEvents,
  validateRawScheduleMatch,
  type LibraryActor as Actor,
  type RawScheduleMatch,
  type ScheduleMatchErrors,
} from "@/lib/library/schedule";
import type { LibraryEvent } from "@/lib/library/store";
import type { EventFormErrors, EventFormInput } from "@/lib/library/event-form";

// Admin Panel > Match Library for a program whose library holds scheduled matches (teams and an optional start time, no score), entered by hand or imported
// from the program's events API. Reads and writes go through the program's data port (lib/program/data.ts); nothing here names a collection or a program.

const MATCH_TYPES = [
  { value: "Q", label: "Q: Qualification" },
  { value: "P", label: "P: Practice" },
  { value: "F", label: "F: Final / playoff" },
];

const blankEvent = (): EventFormInput => ({ name: "", code: "", date: "", sourceUrl: "", defaultVideoUrl: "" });

const toLocalInput = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const showTime = (iso: string | null | undefined): string => {
  if (!iso) return "No time";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "No time" : d.toLocaleString([], { dateStyle: "short", timeStyle: "short" });
};

export function ScheduleLibraryPanel() {
  const { profile, user } = useAuth();
  const data = useProgramData();
  const library = data?.library;
  const seasons = useMemo(() => (data?.games.seasons ?? []).filter((s) => s.enabled), [data]);
  const [seasonId, setSeasonId] = useState(data?.games.defaultSeasonId ?? "");
  const [openCode, setOpenCode] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [importCode, setImportCode] = useState("");
  const [importing, setImporting] = useState(false);

  const teamId = profile?.teamId ?? null;
  const actor: Actor | null = user && profile && teamId ? { teamId, uid: user.uid, name: profile.name } : null;
  const events = useLibraryEvents(seasonId || null);
  const all = useAllLibraryMatches(true, { includeUnpublished: true });
  const summaries = useMemo(() => summarizeEvents(events.events, all.matches), [events.events, all.matches]);
  const openEvent = openCode ? events.events.find((e) => e.eventCode === openCode) ?? null : null;

  const runImport = async () => {
    if (!actor || !library || !seasonId) return;
    setImporting(true);
    setNotice(null);
    try {
      const outcome = await library.importSchedule(actor, { eventCode: importCode, seasonId });
      if (!outcome.ok) {
        setNotice({ tone: "error", text: outcome.message });
        return;
      }
      const result = outcome.summary;
      setOpenCode(result.eventCode);
      setImportCode("");
      setNotice({
        tone: "ok",
        text:
          `${result.eventName}: ${result.created} new, ${result.updated} updated.` +
          (result.skippedNoTeams > 0 ? ` ${result.skippedNoTeams} not scheduled with teams yet (import again later).` : "") +
          (result.skippedManual.length > 0 ? ` Left ${result.skippedManual.length} hand-made match(es) untouched.` : ""),
      });
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof Error ? err.message : "Couldn't import that event. Nothing was lost: run it again." });
    } finally {
      setImporting(false);
    }
  };

  if (openEvent && actor && library) {
    return <EventView event={openEvent} actor={actor} library={library} onBack={() => setOpenCode(null)} />;
  }

  return (
    <GlassPanel className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Match Library</h2>
          <p className="text-xs text-[var(--muted-foreground)]">Scheduled matches for practice and match pickers. Import an event&apos;s schedule from the events API, or enter matches by hand (no API key needed).</p>
        </div>
        <Button className="min-h-11 gap-2" onClick={() => setCreating(true)} disabled={!actor}>
          <Plus className="h-4 w-4" /> New event
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div>
          <Label htmlFor="lib-library-season">Season</Label>
          <select id="lib-library-season" className={selectClass} value={seasonId} onChange={(e) => setSeasonId(e.target.value)}>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-[160px] flex-1">
          <Label htmlFor="lib-library-code">Event code</Label>
          <Input id="lib-library-code" value={importCode} onChange={(e) => setImportCode(e.target.value.toUpperCase())} placeholder="USWASEAQ" />
        </div>
        <Button className="min-h-11 gap-2" disabled={importing || !importCode.trim() || !actor || !library} onClick={() => void runImport()}>
          <Download className="h-4 w-4" /> {importing ? "Importing…" : "Import schedule"}
        </Button>
      </div>
      {notice && (
        <p role={notice.tone === "error" ? "alert" : "status"} className={notice.tone === "error" ? "text-sm text-red-400" : "text-sm text-emerald-400"}>
          {notice.text}
        </p>
      )}

      {events.error ? (
        <div role="alert" className="flex flex-col gap-2 rounded-2xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-200">
          <p>Couldn&apos;t load the library events ({events.error.code}). The list below is not empty because there are none: it did not load.</p>
          <Button variant="glass" className="min-h-11 self-start" onClick={events.retry}>
            Try again
          </Button>
        </div>
      ) : !events.loaded ? (
        <div className="glass-card h-24 animate-pulse" aria-busy="true" />
      ) : summaries.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">No library events yet</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {summaries.map(({ event, matchCount, publishedCount }) => (
            <li key={event.eventCode}>
              <button type="button" className="glass-card flex min-h-11 w-full flex-wrap items-center gap-3 p-3 text-left" onClick={() => setOpenCode(event.eventCode)}>
                <span className="font-medium">{event.eventName}</span>
                <span className="text-xs text-[var(--muted-foreground)]">{event.eventCode}</span>
                <OriginBadge origin={event.origin} />
                <span className="ml-auto text-xs text-[var(--muted-foreground)]">
                  {all.error ? "Counts unavailable" : `${matchCount} match${matchCount === 1 ? "" : "es"}`}
                </span>
                {!all.error && <Badge variant={publishedCount === matchCount && matchCount > 0 ? "success" : "outline"}>{publishedLabel(matchCount, publishedCount)}</Badge>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {all.error && !events.error && <p role="alert" className="text-xs text-red-300">Couldn&apos;t load the match counts ({all.error.code}).</p>}

      {creating && actor && library && (
        <NewEventDialog
          library={library}
          actor={actor}
          seasonId={seasonId}
          existing={events.events}
          onClose={() => setCreating(false)}
          onCreated={(event) => {
            setCreating(false);
            setOpenCode(event.eventCode);
          }}
        />
      )}
    </GlassPanel>
  );
}

type LibraryPort = NonNullable<ReturnType<typeof useProgramData>>["library"];

function NewEventDialog({ library, actor, seasonId, existing, onClose, onCreated }: { library: LibraryPort; actor: Actor; seasonId: string; existing: LibraryEvent[]; onClose: () => void; onCreated: (event: LibraryEvent) => void }) {
  const [form, setForm] = useState<EventFormInput>(blankEvent());
  const [errors, setErrors] = useState<EventFormErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    setError(null);
    const result = await library.createEvent(actor, form, seasonId, existing);
    setSaving(false);
    if (!result.ok) {
      setErrors(result.fieldErrors ?? {});
      setError(result.error);
      return;
    }
    onCreated(result.event);
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="w-[min(92vw,480px)]">
        <DialogTitle>New event</DialogTitle>
        <DialogDescription>A hand-made event for matches the API doesn&apos;t have. Only your team sees it.</DialogDescription>
        <div className="mt-4 flex flex-col gap-4">
          <div>
            <Label htmlFor="lib-ev-name">Event name</Label>
            <Input id="lib-ev-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-invalid={!!errors.name} />
            <FieldError>{errors.name}</FieldError>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="lib-ev-date">Date (optional)</Label>
              <Input id="lib-ev-date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} aria-invalid={!!errors.date} />
              <FieldError>{errors.date}</FieldError>
            </div>
            <div>
              <Label htmlFor="lib-ev-code">Event code (optional)</Label>
              <Input id="lib-ev-code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="Generated if blank" aria-invalid={!!errors.code} />
              <FieldError>{errors.code}</FieldError>
            </div>
          </div>
          {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="glass" className="min-h-11" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button className="min-h-11" onClick={() => void save()} disabled={saving}>
              {saving ? "Saving…" : "Create event"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EventView({ event, actor, library, onBack }: { event: LibraryEvent; actor: Actor; library: LibraryPort; onBack: () => void }) {
  const { matches, loaded, error, retry, unreadable } = useLibraryMatches(event.eventCode, { includeUnpublished: true });
  const [editing, setEditing] = useState<LibraryMatch | "new" | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "match"; match: LibraryMatch } | { kind: "event" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const manual = event.origin === "manual";
  const publishedCount = matches.filter((m) => m.published === true).length;

  const run = async (work: () => Promise<string>) => {
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ tone: "ok", text: await work() });
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error && err.message ? `Couldn't save: ${err.message}` : "Couldn't save. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  };

  const publish = (ids: string[], published: boolean) => run(async () => {
    await library.setPublished(actor, ids, published);
    return `${ids.length} match${ids.length === 1 ? "" : "es"} ${published ? "published" : "unpublished"}.`;
  });

  return (
    <GlassPanel className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="glass" className="min-h-11 gap-2" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> Events
        </Button>
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            {event.eventName} <OriginBadge origin={event.origin} />
          </h2>
          <p className="text-xs text-[var(--muted-foreground)]">
            {event.eventCode}
            {event.date ? ` · ${event.date}` : ""}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          {manual && (
            <Button className="min-h-11 gap-2" onClick={() => setEditing("new")} disabled={busy}>
              <Plus className="h-4 w-4" /> Add match
            </Button>
          )}
          <Button variant="glass" className="min-h-11 gap-2" disabled={busy || matches.length === 0 || publishedCount === matches.length} onClick={() => void publish(matches.filter((m) => m.published !== true).map((m) => m.id), true)}>
            <Eye className="h-4 w-4" /> Publish all
          </Button>
          <Button variant="glass" className="min-h-11 gap-2" disabled={busy || publishedCount === 0} onClick={() => void publish(matches.filter((m) => m.published === true).map((m) => m.id), false)}>
            <EyeOff className="h-4 w-4" /> Unpublish all
          </Button>
          {manual && (
            <Button variant="glass" className="min-h-11 gap-2" disabled={busy} onClick={() => setConfirm({ kind: "event" })}>
              <Trash2 className="h-4 w-4" /> Delete event
            </Button>
          )}
        </div>
      </div>
      {busy && <p role="status" className="text-xs text-[var(--muted-foreground)]">Saving…</p>}
      {message && (
        <p role={message.tone === "error" ? "alert" : "status"} className={message.tone === "error" ? "text-sm text-red-400" : "text-sm text-emerald-400"}>
          {message.text}
        </p>
      )}
      {unreadable > 0 && <p role="alert" className="text-xs text-amber-300">{unreadable} stored match(es) could not be read and are not listed.</p>}

      {error ? (
        <div role="alert" className="flex flex-col gap-2 rounded-2xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-200">
          <p>Couldn&apos;t load this event&apos;s matches ({error.code}). They did not load; this is not an empty event.</p>
          <Button variant="glass" className="min-h-11 self-start" onClick={retry}>
            Try again
          </Button>
        </div>
      ) : !loaded ? (
        <div className="glass-card h-24 animate-pulse" aria-busy="true" />
      ) : matches.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">No matches in this event yet.{manual ? " Use Add match." : ""}</p>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Match</TH>
              <TH>Red</TH>
              <TH>Blue</TH>
              <TH>Time</TH>
              <TH>State</TH>
              <TH>&nbsp;</TH>
            </TR>
          </THead>
          <TBody>
            {matches.map((m) => (
              <TR key={m.id}>
                <TD className="font-medium">{matchLabel(m)}</TD>
                <TD className="text-red-300">{m.alliances.red.teams.length ? m.alliances.red.teams.join(", ") : "TBD"}</TD>
                <TD className="text-blue-300">{m.alliances.blue.teams.length ? m.alliances.blue.teams.join(", ") : "TBD"}</TD>
                <TD className="text-xs">{showTime(m.scheduledTime)}</TD>
                <TD>
                  <Badge variant={m.published === true ? "success" : "outline"}>{m.published === true ? "Published" : "Draft"}</Badge>
                </TD>
                <TD>
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" variant="glass" className="min-h-11 gap-1" disabled={busy} onClick={() => void publish([m.id], m.published !== true)}>
                      {m.published === true ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />} {m.published === true ? "Unpublish" : "Publish"}
                    </Button>
                    {manual && (
                      <>
                        <Button size="sm" variant="glass" className="min-h-11 gap-1" disabled={busy} onClick={() => setEditing(m)} aria-label={`Edit ${matchLabel(m)}`}>
                          <Pencil className="h-3.5 w-3.5" /> Edit
                        </Button>
                        <Button size="sm" variant="glass" className="min-h-11 gap-1" disabled={busy} onClick={() => setConfirm({ kind: "match", match: m })} aria-label={`Delete ${matchLabel(m)}`}>
                          <Trash2 className="h-3.5 w-3.5" /> Delete
                        </Button>
                      </>
                    )}
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {editing && (
        <MatchDialog
          library={library}
          event={event}
          actor={actor}
          match={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(text) => {
            setEditing(null);
            setMessage({ tone: "ok", text });
          }}
        />
      )}

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm?.kind === "event" ? `Delete ${event.eventName}?` : confirm?.kind === "match" ? `Delete ${matchLabel(confirm.match)}?` : ""}
        description={confirm?.kind === "event" ? `This deletes the event and its ${matches.length} match${matches.length === 1 ? "" : "es"}. It can't be undone.` : "This deletes the match. It can't be undone."}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        testId="lib-library-delete-confirm"
        onConfirm={() => {
          const target = confirm;
          if (!target) return;
          if (target.kind === "match") {
            void run(async () => {
              await library.deleteMatches(actor, [target.match.id]);
              return `${matchLabel(target.match)} deleted.`;
            });
          } else {
            void run(async () => {
              const count = await library.deleteEvent(actor, event);
              onBack();
              return `${event.eventName} deleted with ${count} match${count === 1 ? "" : "es"}.`;
            });
          }
        }}
      />
    </GlassPanel>
  );
}

function MatchDialog({ library, event, actor, match, onClose, onSaved }: { library: LibraryPort; event: LibraryEvent; actor: Actor; match: LibraryMatch | null; onClose: () => void; onSaved: (text: string) => void }) {
  const size = useProgramConfig().event.allianceSize;
  const [raw, setRaw] = useState<RawScheduleMatch>(() =>
    match
      ? {
          matchType: match.matchType === "Practice" ? "P" : match.matchType === "Playoff" ? "F" : "Q",
          matchNumber: String(match.matchNumber),
          red: Array.from({ length: size }, (_, i) => String(match.alliances.red.teams[i] ?? "")),
          blue: Array.from({ length: size }, (_, i) => String(match.alliances.blue.teams[i] ?? "")),
          scheduledTime: toLocalInput(match.scheduledTime),
        }
      : emptyRawScheduleMatch(size)
  );
  const [errors, setErrors] = useState<ScheduleMatchErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const checked = validateRawScheduleMatch(raw, size);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    setSaving(true);
    setError(null);
    try {
      const result = await library.upsertMatches(actor, event, [checked.match]);
      onSaved(result.created > 0 ? "Match added (a draft: publish it when ready)." : "Match updated.");
    } catch (err) {
      setError(err instanceof Error && err.message ? `Couldn't save: ${err.message}` : "Couldn't save. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  const setTeam = (color: "red" | "blue", index: number, value: string) => setRaw({ ...raw, [color]: raw[color].map((v, i) => (i === index ? value : v)) });

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="w-[min(92vw,520px)]">
        <DialogTitle>{match ? `Edit ${matchLabel(match)}` : "Add match"}</DialogTitle>
        <DialogDescription>{event.eventName}</DialogDescription>
        <div className="mt-4 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="lib-m-type">Type</Label>
              <select id="lib-m-type" className={`${selectClass} w-full`} value={raw.matchType} disabled={match !== null} onChange={(e) => setRaw({ ...raw, matchType: e.target.value })}>
                {MATCH_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <FieldError>{errors.matchType}</FieldError>
            </div>
            <div>
              <Label htmlFor="lib-m-number">Number</Label>
              <Input id="lib-m-number" inputMode="numeric" value={raw.matchNumber} disabled={match !== null} onChange={(e) => setRaw({ ...raw, matchNumber: e.target.value })} aria-invalid={!!errors.matchNumber} />
              <FieldError>{errors.matchNumber}</FieldError>
            </div>
          </div>
          {(["red", "blue"] as const).map((color) => (
            <fieldset key={color} className="flex flex-col gap-2">
              <legend className={color === "red" ? "text-sm font-medium text-red-300" : "text-sm font-medium text-blue-300"}>{color === "red" ? "Red alliance" : "Blue alliance"}</legend>
              <div className="grid grid-cols-2 gap-3">
                {raw[color].map((value, i) => (
                  <Input key={i} inputMode="numeric" aria-label={`${color} team ${i + 1}`} placeholder="Team number" value={value} onChange={(e) => setTeam(color, i, e.target.value)} aria-invalid={!!errors[color]} />
                ))}
              </div>
              <FieldError>{errors[color]}</FieldError>
            </fieldset>
          ))}
          <FieldError>{errors.teams}</FieldError>
          <div>
            <Label htmlFor="lib-m-time">Scheduled time (optional)</Label>
            <Input id="lib-m-time" type="datetime-local" value={raw.scheduledTime} onChange={(e) => setRaw({ ...raw, scheduledTime: e.target.value })} aria-invalid={!!errors.scheduledTime} />
            <FieldError>{errors.scheduledTime}</FieldError>
          </div>
          {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="glass" className="min-h-11" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button className="min-h-11" onClick={() => void save()} disabled={saving}>
              {saving ? "Saving…" : match ? "Save changes" : "Add match"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useRef, useState } from "react";
import { Download, Eye, EyeOff, RefreshCw, Trophy, Upload, VideoOff } from "lucide-react";
import { AllianceCell } from "@/components/admin/library/alliance-cell";
import { MatchScoreDialog } from "@/components/admin/library/match-score-dialog";
import { OriginBadge, StatusBadge, statusOf } from "@/components/admin/library/manual-library-panel";
import { ReadError, selectClass } from "@/components/admin/library/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { MATCH_TYPE_PREFIX } from "@/lib/analytics/game-schema";
import { useAuth } from "@/lib/auth";
import { useLibraryAdapter, useLibrarySeasons } from "@/lib/library/adapter";
import { importMessage } from "@/lib/library/schedule";
import { useLibraryEvents, type Actor } from "@/lib/library/store";
import { formatTime, parseTimeInput, showScheduledTime } from "@/lib/library/time";
import { canonicalYouTubeUrl, parseYouTubeUrl } from "@/lib/library/youtube-url";
import { importVideoCsv, useLibraryMatches, type LibraryMatch, type LibraryVideo } from "@/lib/match-library";
import { useProgramConfig } from "@/lib/program/context";
import { cn } from "@/lib/utils";
import { withEventYear } from "@/lib/events/names";

type Notice = { kind: "ok" | "error"; text: string };

/**
 * Admin Panel > Match Library > Imported: pull an event from the program's events API, then review what came in (status, publish, video, and, where the
 * API gives a schedule only, the official score). One panel for every program; the data comes through the library adapter and the rules from
 * `ProgramConfig.library`.
 */
export function ImportedLibraryPanel() {
  const { user, profile } = useAuth();
  const adapter = useLibraryAdapter();
  const config = useProgramConfig();
  const { seasons, defaultSeasonId, nameOf } = useLibrarySeasons();
  const showTime = config.library.scheduledTime;
  const actor: Actor | null = user && profile ? { teamId: profile.teamId, uid: user.uid, name: profile.name } : null;

  const [seasonId, setSeasonId] = useState(defaultSeasonId);
  const [eventCodeInput, setEventCodeInput] = useState("");
  const [viewingEventCode, setViewingEventCode] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [csvMessage, setCsvMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scoring, setScoring] = useState<{ key: number; match: LibraryMatch } | null>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);

  const { events, error: eventsError, retry: retryEvents } = useLibraryEvents();
  const importedEvents = events.filter((e) => e.origin !== "manual" && e.seasonId === seasonId);
  const { matches, loaded, error: matchesError, retry: retryMatches, unreadable } = useLibraryMatches(viewingEventCode, { includeUnpublished: true });
  const missingVideoCount = matches.filter((m) => !m.video).length;
  const reviewMatches = matches.filter((m) => statusOf(m) === "review");
  const publishedCount = matches.filter((m) => statusOf(m) === "published").length;
  const hasTimes = showTime && matches.some((m) => m.scheduledTime);

  const handleImport = async (code: string) => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed || !actor) return;
    setImporting(true);
    setNotice(null);
    try {
      const outcome = await adapter.importEvent(actor, { eventCode: trimmed, seasonId });
      if (!outcome.ok) {
        setNotice({ kind: "error", text: outcome.message });
        return;
      }
      setViewingEventCode(outcome.summary.eventCode);
      setNotice({ kind: "ok", text: importMessage(outcome.summary) });
    } catch (err) {
      setNotice({ kind: "error", text: err instanceof Error ? err.message : "Couldn't import that event." });
    } finally {
      setImporting(false);
    }
  };

  const run = async (work: () => Promise<string>) => {
    setBusy(true);
    setNotice(null);
    try {
      setNotice({ kind: "ok", text: await work() });
    } catch (err) {
      console.error("library action failed:", err);
      setNotice({ kind: "error", text: "That didn't save. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  };

  const publish = (ids: string[], published: boolean) =>
    actor &&
    ids.length > 0 &&
    run(async () => {
      await adapter.setPublished(actor, ids, published);
      return `${published ? "Published" : "Unpublished"} ${ids.length} match${ids.length === 1 ? "" : "es"}.`;
    });

  const handleCsvFile = async (file: File) => {
    const text = await file.text();
    setCsvMessage(null);
    const result = await importVideoCsv(text);
    setCsvMessage(`Updated ${result.updated} match${result.updated === 1 ? "" : "es"}.` + (result.errors.length > 0 ? ` ${result.errors.length} row${result.errors.length === 1 ? "" : "s"} skipped.` : ""));
  };

  const refreshLabel = config.library.importKind === "schedule" ? "Refresh schedule" : "Refresh scores";

  return (
    <>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <Label htmlFor="library-season">Season</Label>
          <Select value={seasonId} onValueChange={setSeasonId}>
            <SelectTrigger id="library-season" className="w-40">
              <SelectValue>{nameOf(seasonId)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {seasons.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-[160px] flex-1">
          <Label htmlFor="library-event-code">Event code</Label>
          <Input id="library-event-code" value={eventCodeInput} onChange={(e) => setEventCodeInput(e.target.value.toUpperCase())} placeholder="USWABON1" />
        </div>
        <Button className="gap-2" disabled={importing || !eventCodeInput.trim() || !actor} onClick={() => void handleImport(eventCodeInput)}>
          <Download className="h-4 w-4" /> {importing ? "Importing…" : "Import event"}
        </Button>
        {viewingEventCode && (
          <Button variant="glass" className="gap-2" disabled={importing || !actor} onClick={() => void handleImport(viewingEventCode)}>
            <RefreshCw className={importing ? "h-4 w-4 animate-spin" : "h-4 w-4"} /> {refreshLabel}
          </Button>
        )}
      </div>

      {notice && (
        <p role={notice.kind === "error" ? "alert" : "status"} className={cn("text-sm", notice.kind === "ok" ? "text-emerald-400" : "text-red-400")}>
          {notice.text}
        </p>
      )}

      {eventsError ? (
        <ReadError what="the imported events" error={eventsError} onRetry={retryEvents} />
      ) : (
        importedEvents.length > 0 && (
          <div className="min-w-[220px] sm:max-w-md">
            <Label htmlFor="imported-event">Imported event</Label>
            <select id="imported-event" className={cn(selectClass, "w-full")} value={viewingEventCode ?? ""} onChange={(e) => setViewingEventCode(e.target.value || null)}>
              <option value="">Choose an imported event…</option>
              {importedEvents.map((e) => (
                <option key={e.eventCode} value={e.eventCode}>
                  {withEventYear(e.eventName, e.eventCode)} ({e.eventCode})
                </option>
              ))}
              {viewingEventCode && !importedEvents.some((e) => e.eventCode === viewingEventCode) && <option value={viewingEventCode}>{viewingEventCode}</option>}
            </select>
          </div>
        )
      )}

      {config.library.videoCsv && (
        <div className="flex flex-wrap items-center gap-3 border-t border-[var(--glass-border)] pt-4">
          <input ref={csvInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && handleCsvFile(e.target.files[0])} />
          <Button variant="glass" size="sm" className="gap-2" onClick={() => csvInputRef.current?.click()}>
            <Upload className="h-3.5 w-3.5" /> Bulk import video CSV
          </Button>
          <span className="text-xs text-[var(--muted-foreground)]">Columns: matchKey, url, startSec, endSec (the times are optional)</span>
          {csvMessage && <span className="text-xs text-emerald-400">{csvMessage}</span>}
        </div>
      )}

      {viewingEventCode && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{viewingEventCode}</h3>
            {missingVideoCount > 0 && <Badge variant="warning">{missingVideoCount} missing video</Badge>}
            <div className="ml-auto flex flex-wrap gap-2">
              <Button size="sm" variant="glass" className="gap-1.5" disabled={busy || matches.length === 0 || publishedCount === matches.length} onClick={() => void publish(matches.filter((m) => statusOf(m) !== "published").map((m) => m.id), true)}>
                <Eye className="h-3.5 w-3.5" /> Publish all
              </Button>
              <Button size="sm" variant="glass" className="gap-1.5" disabled={busy || publishedCount === 0} onClick={() => void publish(matches.filter((m) => statusOf(m) === "published").map((m) => m.id), false)}>
                <EyeOff className="h-3.5 w-3.5" /> Unpublish all
              </Button>
            </div>
          </div>
          {reviewMatches.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
              <span className="min-w-0 flex-1">
                {reviewMatches.length} imported match{reviewMatches.length === 1 ? "" : "es"} need{reviewMatches.length === 1 ? "s" : ""} review. They&apos;re hidden from scouts until published.
              </span>
              <Button size="sm" disabled={busy} onClick={() => void publish(reviewMatches.map((m) => m.id), true)}>
                Publish all ({reviewMatches.length})
              </Button>
            </div>
          )}
          {unreadable > 0 && (
            <p role="alert" className="text-xs text-amber-300">
              {unreadable} stored match{unreadable === 1 ? "" : "es"} could not be read and {unreadable === 1 ? "is" : "are"} not listed.
            </p>
          )}
          {matchesError ? (
            <ReadError what="this event's matches" error={matchesError} onRetry={retryMatches} />
          ) : !loaded ? (
            <div className="glass-card h-24 animate-pulse" />
          ) : matches.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">No matches imported for this event yet.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Match</TH>
                  <TH>Red</TH>
                  <TH>Blue</TH>
                  {hasTimes && <TH>Time</TH>}
                  <TH>Video</TH>
                  <TH>Start</TH>
                  <TH>End</TH>
                  <TH>Status</TH>
                  <TH>&nbsp;</TH>
                </TR>
              </THead>
              <TBody>
                {matches.map((m) => (
                  <ImportedMatchRow
                    key={m.id}
                    match={m}
                    actor={actor}
                    busy={busy}
                    showTime={hasTimes}
                    onPublish={(published) => void publish([m.id], published)}
                    onScore={config.library.editImportedScores ? () => setScoring({ key: Date.now(), match: m }) : undefined}
                  />
                ))}
              </TBody>
            </Table>
          )}
        </div>
      )}

      {scoring && actor && (
        <MatchScoreDialog
          key={scoring.key}
          match={scoring.match}
          actor={actor}
          onClose={() => setScoring(null)}
          onSaved={(text) => {
            setScoring(null);
            setNotice({ kind: "ok", text });
          }}
        />
      )}
    </>
  );
}

export function ImportedMatchRow({ match, actor, busy, showTime, onPublish, onScore }: { match: LibraryMatch; actor: Actor | null; busy: boolean; showTime: boolean; onPublish: (published: boolean) => void; onScore?: () => void }) {
  const adapter = useLibraryAdapter();
  const [url, setUrl] = useState(match.video?.youtubeUrl ?? "");
  const [startSec, setStartSec] = useState(typeof match.video?.startSec === "number" ? formatTime(match.video.startSec) : "");
  const [endSec, setEndSec] = useState(typeof match.video?.endSec === "number" ? formatTime(match.video.endSec) : "");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const status = statusOf(match);
  const label = `${MATCH_TYPE_PREFIX[match.matchType]}${match.matchNumber}`;

  const dirty =
    url !== (match.video?.youtubeUrl ?? "") ||
    startSec !== (typeof match.video?.startSec === "number" ? formatTime(match.video.startSec) : "") ||
    endSec !== (typeof match.video?.endSec === "number" ? formatTime(match.video.endSec) : "");

  const handleSave = async () => {
    if (!actor) return;
    setSaving(true);
    try {
      // FIX3: start and end are optional — blank start = the beginning, blank end = the video's end. Only an unreadable time (or end <= start when both are given) blocks the save.
      setSaveError(null);
      const parsed = url.trim() ? parseYouTubeUrl(url) : null;
      if (url.trim() && !parsed) {
        setSaveError("That does not look like a YouTube link.");
        return;
      }
      const start = startSec.trim() === "" ? null : parseTimeInput(startSec);
      const end = endSec.trim() === "" ? null : parseTimeInput(endSec);
      if ((startSec.trim() !== "" && start === null) || (endSec.trim() !== "" && end === null)) {
        setSaveError("Use seconds (90), 1:30, or 1:02:30 — or leave a time blank.");
        return;
      }
      if (start !== null && end !== null && end <= start) {
        setSaveError("The end time must be after the start time.");
        return;
      }
      const video: LibraryVideo | null = parsed ? { youtubeUrl: canonicalYouTubeUrl(parsed.videoId), startSec: start, endSec: end } : null;
      await adapter.setMatchVideo(actor, match.id, video);
    } catch (err) {
      console.error("couldn't save the video:", err);
      setSaveError("Couldn't save. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <TR>
      <TD className="font-medium">
        <span className="flex items-center gap-2">
          {label}
          <OriginBadge origin={match.origin === "manual" ? "manual" : "api"} />
        </span>
      </TD>
      <TD>
        <AllianceCell side="red" alliance={match.alliances.red} />
      </TD>
      <TD>
        <AllianceCell side="blue" alliance={match.alliances.blue} />
      </TD>
      {showTime && <TD className="text-xs">{showScheduledTime(match.scheduledTime)}</TD>}
      <TD className="min-w-[200px]">
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://youtube.com/watch?v=..." aria-label={`Video link for ${label}`} className="h-8 text-xs" />
      </TD>
      <TD className="w-20">
        <Input value={startSec} onChange={(e) => setStartSec(e.target.value)} placeholder="start (optional)" aria-label="Start time (optional)" className="h-8 text-xs" aria-invalid={!!saveError} />
      </TD>
      <TD className="w-20">
        <Input value={endSec} onChange={(e) => setEndSec(e.target.value)} placeholder="end (optional)" aria-label="End time (optional)" className="h-8 text-xs" aria-invalid={!!saveError} />
      </TD>
      <TD>
        <StatusBadge status={status} />
      </TD>
      <TD>
        <div className="flex flex-wrap items-center gap-1.5">
          {!match.video && !dirty ? (
            <span title="Missing video">
              <VideoOff className="h-4 w-4 text-amber-400" />
            </span>
          ) : (
            <Button size="sm" variant="glass" disabled={!dirty || saving} onClick={handleSave}>
              {saving ? "Saving…" : "Save"}
            </Button>
          )}
          <Button size="sm" variant="glass" className="gap-1" disabled={busy} aria-label={`${status === "published" ? "Unpublish" : "Publish"} ${label}`} onClick={() => onPublish(status !== "published")}>
            {status === "published" ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />} {status === "published" ? "Unpublish" : "Publish"}
          </Button>
          {onScore && (
            <Button size="sm" variant="glass" className="gap-1" disabled={busy} aria-label={`Official score for ${label}`} onClick={onScore}>
              <Trophy className="h-3.5 w-3.5" /> Score
            </Button>
          )}
        </div>
        {saveError && (
          <p role="alert" className="mt-1 max-w-[12rem] text-[10px] text-red-300">
            {saveError}
          </p>
        )}
      </TD>
    </TR>
  );
}

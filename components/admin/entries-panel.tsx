"use client";

import { useState } from "react";
import { Pencil, Search } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Label } from "@/components/ui/input";
import { Shimmer } from "@/components/ui/shimmer";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EntryEditDialog } from "@/components/admin/entry-edit-dialog";
import { FormEntryEditDialog } from "@/components/admin/form-entry-edit-dialog";
import { buildEntryRows, entryEvents, entryFormKeys, filterEntryRows, type EntryRow } from "@/lib/admin/entry-rows";
import { useAuth } from "@/lib/auth";
import { useFormEntries } from "@/lib/form-entries";
import { FORM_TYPES } from "@/lib/forms/types";
import { useFormDisplayNames } from "@/lib/forms/use-form-display-name";
import { useTeamScoutEntries } from "@/lib/scout-entries";

const ALL = "all";
const PAGE = 50;
const when = (ms: number) => (ms > 0 ? new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "");

/**
 * Admin Panel > Entries (Session E): every entry of the team, Match Scout and each of the other forms, in one list with a search, a Form filter and an Event
 * filter. Edit opens the answer editor for that entry (`EntryEditDialog` for Match Scout, `FormEntryEditDialog` for the others; both audit-logged). Editing is
 * never closed by the team's submission switches. Practice entries are in Admin > Sessions.
 */
export function EntriesPanel() {
  const { user, profile } = useAuth();
  const teamId = profile?.teamId ?? null;
  const names = useFormDisplayNames();
  const scout = useTeamScoutEntries(teamId);
  const others = useFormEntries(teamId, { game: "all" });
  const [formKey, setFormKey] = useState(ALL);
  const [eventCode, setEventCode] = useState(ALL);
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [editing, setEditing] = useState<EntryRow | null>(null);

  if (!teamId || !user) return <p className="text-sm text-[var(--muted-foreground)]">Join or create a team to see its entries.</p>;
  if (!scout.loaded || !others.loaded) return <Shimmer className="h-64" />;

  const all = buildEntryRows(scout.entries, others.entries);
  const rows = filterEntryRows(all, { formKey: formKey === ALL ? null : formKey, eventCode: eventCode === ALL ? null : eventCode, query });
  const formLabel = (key: string) => (key === "custom" ? "Custom forms" : names.forType(key));
  const formKeys = entryFormKeys(all, FORM_TYPES);

  return (
    <GlassPanel className="flex flex-col gap-4" data-testid="entries-panel">
      <div>
        <h2 className="text-base font-semibold">Entries</h2>
        <p className="text-sm text-[var(--muted-foreground)]">
          Every entry of the team, newest first. Edit corrects the answers of one entry (the change is logged in the Audit Log). Practice entries are under Sessions.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="entries-form">Form</Label>
          <Select
            value={formKey}
            onValueChange={(v) => {
              setFormKey(v);
              setShown(PAGE);
            }}
          >
            <SelectTrigger id="entries-form" className="w-64" data-testid="entries-form-select">
              <SelectValue>{formKey === ALL ? "All forms" : formLabel(formKey)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All forms</SelectItem>
              {formKeys.map((k) => (
                <SelectItem key={k} value={k}>
                  {formLabel(k)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="entries-event">Event</Label>
          <Select
            value={eventCode}
            onValueChange={(v) => {
              setEventCode(v);
              setShown(PAGE);
            }}
          >
            <SelectTrigger id="entries-event" className="w-48" data-testid="entries-event-select">
              <SelectValue>{eventCode === ALL ? "All events" : eventCode}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All events</SelectItem>
              {entryEvents(all).map((code) => (
                <SelectItem key={code} value={code}>
                  {code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex min-w-48 flex-1 flex-col gap-1.5">
          <Label htmlFor="entries-search">Search</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" aria-hidden />
            <Input
              id="entries-search"
              className="pl-9"
              placeholder="Team number or scout name"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setShown(PAGE);
              }}
            />
          </div>
        </div>
      </div>

      {all.length === 0 ? (
        <p className="glass-card p-4 text-sm text-[var(--muted-foreground)]">No entries yet.</p>
      ) : rows.length === 0 ? (
        <p className="glass-card p-4 text-sm text-[var(--muted-foreground)]">No entries match these filters.</p>
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Form</TH>
                <TH>Event</TH>
                <TH>Match</TH>
                <TH>Team</TH>
                <TH>Scout</TH>
                <TH>Saved</TH>
                <TH>
                  <span className="sr-only">Actions</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {rows.slice(0, shown).map((r) => (
                <TR key={r.key} data-testid="entry-row">
                  <TD>
                    {formLabel(r.formKey)}
                    {r.entry.excluded && (
                      <Badge variant="outline" className="ml-2 text-[10px]">
                        Excluded
                      </Badge>
                    )}
                  </TD>
                  <TD className="font-mono text-xs">{r.eventCode}</TD>
                  <TD>{r.match || "—"}</TD>
                  <TD className="tabular-nums">{r.teamNumber ?? "—"}</TD>
                  <TD>{r.scoutName}</TD>
                  <TD className="whitespace-nowrap text-xs text-[var(--muted-foreground)]">{when(r.whenMs)}</TD>
                  <TD className="text-right">
                    <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setEditing(r)} aria-label={`Edit the ${formLabel(r.formKey)} entry for team ${r.teamNumber ?? "?"} by ${r.scoutName}`}>
                      <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <div className="flex items-center justify-between gap-3 text-xs text-[var(--muted-foreground)]">
            <span>
              Showing {Math.min(shown, rows.length)} of {rows.length}
            </span>
            {rows.length > shown && (
              <Button variant="glass" size="sm" onClick={() => setShown((n) => n + PAGE)}>
                Show more
              </Button>
            )}
          </div>
        </>
      )}

      <EntryEditDialog
        entry={editing?.kind === "scout" ? editing.entry : null}
        open={editing?.kind === "scout"}
        onOpenChange={(open) => !open && setEditing(null)}
        teamId={teamId}
        actorUid={user.uid}
        actorName={profile?.name ?? ""}
      />
      <FormEntryEditDialog
        entry={editing?.kind === "form" ? editing.entry : null}
        open={editing?.kind === "form"}
        onOpenChange={(open) => !open && setEditing(null)}
        teamId={teamId}
        actorUid={user.uid}
        actorName={profile?.name ?? ""}
      />
    </GlassPanel>
  );
}

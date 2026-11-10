"use client";

import { useState } from "react";
import { ArrowLeft, UserCog } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Label } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { MatchType } from "@/lib/ftc/types";
import { requestSubIn } from "@/lib/sub-ins/store";
import { activeRequestFor, parseRange, slotsInRange, subInMatchKey, subInMatchLabel, type SubInActor, type SubInRequest, type SubInTarget } from "@/lib/sub-ins/model";
import type { ScheduleSlot } from "@/lib/scheduler/types";

const TYPES: { value: MatchType; label: string }[] = [
  { value: "Practice", label: "Practice" },
  { value: "Qualification", label: "Qualification" },
  { value: "Playoff", label: "Finals" },
];

/**
 * CS "Request Sub-In" (scout form): one match, or a range of matches (x-y, inclusive), only for matches the scout is ASSIGNED to. The requested robot is the one
 * they were assigned. `assigned` is what they can still hand over (their upcoming assigned matches, including sub-ins they took); results show in the dialog,
 * never in an alert.
 */
export function RequestSubIn({
  teamId,
  eventKey,
  actor,
  assigned,
  requests,
  defaultType = "Qualification",
}: {
  teamId: string | null;
  eventKey: string | null;
  actor: SubInActor | null;
  /** The scout's upcoming assigned matches: slots (one robot each) with their uid. */
  assigned: ScheduleSlot[];
  requests: readonly SubInRequest[];
  defaultType?: MatchType;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"choice" | "one" | "range">("choice");
  const [type, setType] = useState<MatchType>(defaultType);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  /** Taken when the dialog opens (render must stay pure): which requests are still standing at that moment. */
  const [openedAt, setOpenedAt] = useState(0);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const ready = !!teamId && !!eventKey && !!actor;
  const sorted = [...assigned].sort((a, b) => (a.matchType === b.matchType ? a.matchNumber - b.matchNumber : TYPES.findIndex((t) => t.value === a.matchType) - TYPES.findIndex((t) => t.value === b.matchType)));

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setOpenedAt(Date.now());
      setStep("choice");
      setType(defaultType);
      setStart("");
      setEnd("");
      setMessage(null);
    }
  };

  const send = async (target: SubInTarget): Promise<"requested" | "skipped" | "error"> => {
    if (!ready || !teamId || !eventKey || !actor) return "error";
    const result = await requestSubIn({ teamId, eventKey, actor, target, existing: requests });
    if (result.ok) return "requested";
    // an existing request is a skip, a failed write an error (CS counted them apart)
    return /already been/.test(result.reason) ? "skipped" : "error";
  };

  const requestOne = async (slot: ScheduleSlot) => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const target = { matchType: slot.matchType, matchNumber: slot.matchNumber, teamNumber: slot.teamNumber };
    const outcome = await send(target);
    setBusy(false);
    setMessage(
      outcome === "requested"
        ? { tone: "ok", text: `Sub-in requested for ${subInMatchLabel(slot.matchType, slot.matchNumber)}.` }
        : outcome === "skipped"
          ? { tone: "error", text: "A sub-in is already requested or assigned for that match." }
          : { tone: "error", text: "Could not send the request. Check your connection and try again." }
    );
  };

  const requestRange = async () => {
    if (busy || !actor) return;
    const range = parseRange(start, end);
    if (!range) {
      setMessage({ tone: "error", text: "Enter a valid match range (e.g. 45 to 65)." });
      return;
    }
    const inRange = slotsInRange(assigned, actor.uid, type, range.start, range.end);
    if (inRange.length === 0) {
      setMessage({ tone: "error", text: "No assigned matches found in that range." });
      return;
    }
    setBusy(true);
    setMessage(null);
    let requested = 0;
    let skipped = 0;
    let failed = 0;
    for (const slot of inRange) {
      const outcome = await send({ matchType: slot.matchType, matchNumber: slot.matchNumber, teamNumber: slot.teamNumber });
      if (outcome === "requested") requested += 1;
      else if (outcome === "skipped") skipped += 1;
      else failed += 1;
    }
    setBusy(false);
    setMessage({ tone: failed > 0 ? "error" : "ok", text: `Sub-in requests: ${requested} requested, ${skipped} skipped, ${failed} failed.` });
  };

  const stateOf = (slot: ScheduleSlot): "requested" | "assigned" | null => {
    const existing = eventKey ? activeRequestFor(requests, eventKey, subInMatchKey(slot.matchType, slot.matchNumber), slot.teamNumber, openedAt) : null;
    return existing ? (existing.status === "claimed" ? "assigned" : "requested") : null;
  };

  return (
    <>
      <Button type="button" size="lg" variant="glass" className="min-h-11 gap-2" disabled={!ready} onClick={() => handleOpenChange(true)} data-testid="request-sub-in">
        <UserCog className="h-4 w-4" aria-hidden /> Request Sub-In
      </Button>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="w-[min(92vw,480px)]" data-testid="sub-in-dialog">
          {step === "choice" && (
            <>
              <DialogTitle>Request Sub-In</DialogTitle>
              <DialogDescription>Ask the team to cover a match you are assigned to. Pick one match or several.</DialogDescription>
              <div className="mt-4 flex flex-col gap-3">
                <Button type="button" size="lg" className="min-h-11" onClick={() => setStep("one")} data-testid="sub-in-one">
                  One match
                </Button>
                <Button type="button" size="lg" variant="glass" className="min-h-11" onClick={() => setStep("range")} data-testid="sub-in-range">
                  Multiple matches
                </Button>
              </div>
            </>
          )}
          {step === "one" && (
            <>
              <BackButton onClick={() => setStep("choice")} />
              <DialogTitle>Which match?</DialogTitle>
              <DialogDescription>Only matches assigned to you can be handed over.</DialogDescription>
              {sorted.length === 0 ? (
                <p className="glass-card mt-4 p-4 text-sm text-[var(--muted-foreground)]" data-testid="sub-in-none">
                  You have no upcoming assigned matches. Ask a lead to publish the assignments.
                </p>
              ) : (
                <ul className="mt-4 flex max-h-[45vh] flex-col gap-2 overflow-y-auto pr-1">
                  {sorted.map((slot) => {
                    const state = stateOf(slot);
                    return (
                      <li key={`${slot.matchType}-${slot.matchNumber}-${slot.teamNumber}`}>
                        <button
                          type="button"
                          disabled={busy || state !== null}
                          onClick={() => void requestOne(slot)}
                          className="glass-card flex min-h-14 w-full items-center justify-between gap-3 p-3.5 text-left transition-colors hover:bg-white/8 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <span>
                            <span className="font-semibold">{subInMatchLabel(slot.matchType, slot.matchNumber)}</span>
                            <span className="ml-2 text-sm text-[var(--muted-foreground)]">Team {slot.teamNumber}</span>
                          </span>
                          {state && <Badge variant="warning">{state === "assigned" ? "Sub Assigned" : "Sub Req"}</Badge>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
          {step === "range" && (
            <>
              <BackButton onClick={() => setStep("choice")} />
              <DialogTitle>Multiple matches</DialogTitle>
              <DialogDescription>Enter a range, first and last inclusive. Only matches in that range that you are assigned to are requested.</DialogDescription>
              <div className="mt-4 flex flex-col gap-3">
                <div>
                  <Label htmlFor="sub-in-type">Match type</Label>
                  <Select value={type} onValueChange={(v) => setType(v as MatchType)}>
                    <SelectTrigger id="sub-in-type">
                      <SelectValue>{TYPES.find((t) => t.value === type)?.label}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <Label htmlFor="sub-in-start">From match</Label>
                    <Input id="sub-in-start" inputMode="numeric" autoComplete="off" placeholder="45" value={start} onChange={(e) => setStart(e.target.value.replace(/\D/g, ""))} />
                  </div>
                  <span className="pb-3 text-sm text-[var(--muted-foreground)]">to</span>
                  <div className="flex-1">
                    <Label htmlFor="sub-in-end">To match</Label>
                    <Input id="sub-in-end" inputMode="numeric" autoComplete="off" placeholder="65" value={end} onChange={(e) => setEnd(e.target.value.replace(/\D/g, ""))} />
                  </div>
                </div>
                <Button type="button" size="lg" className="min-h-11" disabled={busy || !start || !end} onClick={() => void requestRange()} data-testid="sub-in-send-range">
                  {busy ? "Requesting…" : "Request range"}
                </Button>
              </div>
            </>
          )}
          {message && (
            <p role={message.tone === "error" ? "alert" : "status"} data-testid="sub-in-message" className={`mt-3 text-sm font-medium ${message.tone === "error" ? "text-red-300" : "text-emerald-300"}`}>
              {message.text}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="mb-2 inline-flex min-h-11 items-center gap-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
      <ArrowLeft className="h-4 w-4" aria-hidden /> Back
    </button>
  );
}

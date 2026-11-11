/**
 * Adapter between CS's `teams/{TEAMCODE}` document and CE's `TeamDoc` (lib/team.ts). docs/ROUTES.md D1, D10, D12.
 * No React, no Firebase.
 *
 * `selectedEvents: string[]` (TBA keys) is the SINGLE source of truth for a team's active events. CE's `activeEvents` /
 * `activeEventCode` / `activeEvent` / `activeEventCodes` are DERIVED from it on read (a placeholder `EventInfo` per key, which
 * `useActiveEvents` enriches with the event's real name and dates), and `selectedEventsPatch` writes only `selectedEvents`.
 * Every other CS team field (`eventAttendees`, `manualTeamListsByEvent`, `formAccessOverrides`, `submissionControls`,
 * `tbaApiKey*`, `judgeBookCards`, ...) is never written by this adapter, so a merge write leaves it untouched.
 */
import { dedupeEventKeys, EVENT_CONFIG, getSeasonFromEventKey, normalizeEventKey } from "@/config/event";
import type { CsRecord, CsSubmissionControls, CsTeamDoc, SubmissionLockout } from "@/data/cs/types";
import { isRecord, str } from "@/data/cs/util";
import { MAX_ACTIVE_EVENTS, type ActiveEventsState } from "@/lib/active-events";
import type { EventInfo } from "@/lib/events/types";
import type { TeamDoc } from "@/lib/team";

/** Shown by CS when a lockout has no reason (app/utils/submissionControls.ts). */
export const DEFAULT_LOCKOUT_REASON = "Submissions are temporarily disabled by your team admins.";

/** A placeholder `EventInfo` for a TBA key: code = key, season from the key, name = key, no dates until enriched. */
export function placeholderEventForKey(key: string): EventInfo {
  return {
    code: key,
    season: getSeasonFromEventKey(key) ?? EVENT_CONFIG.season,
    name: key,
    dateStart: "",
    dateEnd: "",
    city: null,
    stateProv: null,
    country: null,
    venue: null,
    website: null,
    timezone: null,
    status: "upcoming",
  };
}

/** `selectedEvents` as stored -> clean keys: strings only, alias-normalized, de-duplicated, first-seen order. */
export function readSelectedEvents(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return dedupeEventKeys(value.filter((v): v is string => typeof v === "string"));
}

/** CS lockout (`submissionControls.globalLockout`) as CE's gate state; `assertSubmissionsOpen` semantics. */
export function readSubmissionLockout(controls: CsSubmissionControls | null | undefined): SubmissionLockout {
  return { locked: Boolean(controls?.globalLockout), reason: str(controls?.lockoutReason).trim() || DEFAULT_LOCKOUT_REASON };
}

/** The lockout for a normalized team: a missing team (or no controls) is open. Edit mode bypasses it at the call site. */
export function getSubmissionLockout(team: Pick<TeamDoc, "submissionControls"> | null | undefined): SubmissionLockout {
  return readSubmissionLockout(team?.submissionControls);
}

/** CE-written team fields (additive) that pass through the normalizer unchanged when present on the doc. */
const CE_PASSTHROUGH = [
  "fieldTeams",
  "fieldTeamIdList",
  "fieldTeamNumbers",
  "activeForms",
  "accountName",
  "pendingTransfer",
  "usePlaceholderVideo",
  "changelogSeeded",
  "libraryBackfilled",
] as const;

/** Reads `teams/{id}` as CE's `TeamDoc`. `id` is the uppercase join code (it doubles as `joinCode`). */
export function csTeamToTeamDoc(id: string, doc: CsTeamDoc): TeamDoc {
  const selectedEvents = readSelectedEvents(doc.selectedEvents);
  const events = selectedEvents.map(placeholderEventForKey);
  const primary = events[0] ?? null;
  const rawNumber = typeof doc.teamNumber === "number" ? doc.teamNumber : Number(String(doc.teamNumber ?? "").replace(/[^\d]/g, ""));
  const controls = isRecord(doc.submissionControls) ? (doc.submissionControls as CsSubmissionControls) : undefined;
  const record = doc as CsRecord;

  const team: TeamDoc = {
    number: Number.isFinite(rawNumber) ? rawNumber : 0,
    name: str(doc.teamName).trim() || null,
    joinCode: id,
    ...(str(doc.verifiedOwnerId).trim() || str(record.ownerUid).trim() ? { ownerUid: str(doc.verifiedOwnerId).trim() || str(record.ownerUid).trim() } : {}),
    activeEventCode: primary?.code ?? null,
    activeSeasonId: primary?.season ?? null,
    activeEvent: primary,
    activeEventCodes: selectedEvents,
    activeEvents: events,
    selectedEvents,
    ...(controls ? { submissionControls: controls } : {}),
    submissionLockout: readSubmissionLockout(controls),
    ...(isRecord(doc.eventAttendees) ? { eventAttendees: doc.eventAttendees as Record<string, string[]> } : {}),
    ...(isRecord(doc.manualTeamListsByEvent) ? { manualTeamListsByEvent: doc.manualTeamListsByEvent } : {}),
    ...(isRecord(doc.formAccessOverrides) ? { formAccessOverrides: doc.formAccessOverrides as Record<string, string[]> } : {}),
    ...(isRecord(doc.timeOverride) ? { timeOverride: doc.timeOverride as NonNullable<CsTeamDoc["timeOverride"]> } : {}),
  };
  const out: Record<string, unknown> = team;
  for (const key of CE_PASSTHROUGH) if (record[key] !== undefined) out[key] = record[key];
  return team;
}

/**
 * The `selectedEvents` value for an active-events state: primary first, alias-normalized, de-duplicated, at most
 * `MAX_ACTIVE_EVENTS` (10). `state.events` order is the priority order (the primary is whatever is first).
 */
export function buildSelectedEvents(state: ActiveEventsState): string[] {
  const primary = state.events.find((e) => e.code === state.primaryCode);
  const ordered = primary ? [primary, ...state.events.filter((e) => e.code !== primary.code)] : state.events;
  return dedupeEventKeys(ordered.map((e) => e.code)).slice(0, MAX_ACTIVE_EVENTS);
}

/** The ONLY write the adapter makes for events: `setDoc(teams/{id}, selectedEventsPatch(state), { merge: true })`. */
export function selectedEventsPatch(state: ActiveEventsState): { selectedEvents: string[] } {
  return { selectedEvents: buildSelectedEvents(state) };
}

/** Normalizes an event code typed or stored anywhere to the TBA key the team doc uses. */
export { normalizeEventKey };

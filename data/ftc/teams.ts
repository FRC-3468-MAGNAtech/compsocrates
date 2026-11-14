/**
 * Adapter between an FTC `programs/ftc/teams/{teamId}` document and the app's `TeamDoc` (lib/team.ts). No React, no Firebase.
 *
 * The stored doc is the sister app's schema. An account there can hold several FTC teams (`fieldTeams`); this app has one team
 * per account (D13, lib/our-team.ts), so the app's `number` / `name` come from the FIRST entry of `fieldTeams`, falling back to
 * the legacy single `number` / `name` on accounts the multi-team change has not reached. The whole list stays available through
 * `readFieldTeams` for the day a team switcher needs it.
 *
 * Active events are stored denormalized (`activeEvent`, `activeEvents`, `activeEventCodes`) and read as they are; nothing here
 * derives them from another field. Server-written fields (`ownerUid`, `pendingTransfer`) pass through untouched.
 */
import type { EventInfo, EventLifecycleStatus } from "@/lib/events/types";
import type { TeamDoc } from "@/lib/team";
import type { AccountTeam } from "@/lib/team-number";
import { digitsToNumber, finiteNumber, isRecord, nonEmptyString, str, stringList, stripUndefined } from "@/data/ftc/util";
import { orderPrimaryFirst, type ActiveEventsState } from "@/lib/active-events";

export type FtcFieldTeam = { id: string; number: number; name: string };

/** `programs/ftc/teams/{teamId}` as stored. Everything optional: older docs lack most of it. */
export type FtcTeamDoc = {
  number?: unknown;
  name?: unknown;
  fieldTeams?: unknown;
  fieldTeamIdList?: unknown;
  fieldTeamNumbers?: unknown;
  accountName?: unknown;
  joinCode?: unknown;
  ownerUid?: unknown;
  pendingTransfer?: unknown;
  activeForms?: unknown;
  activeEventCode?: unknown;
  activeSeasonId?: unknown;
  activeEvent?: unknown;
  activeEventCodes?: unknown;
  activeEvents?: unknown;
  usePlaceholderVideo?: unknown;
  changelogSeeded?: unknown;
  libraryBackfilled?: unknown;
  [key: string]: unknown;
};

/** The id the account's original single team gets when it has no `fieldTeams` yet (deterministic: a repeated migration agrees with itself). */
export const migratedFieldTeamId = (number: number): string => `ft-${number}`;

const EVENT_STATUSES: readonly EventLifecycleStatus[] = ["upcoming", "in-progress", "completed"];

function numberFrom(value: unknown): number {
  return finiteNumber(value) ?? digitsToNumber(value);
}

/**
 * The account's FTC teams in the admin's order. Entries without an id or a positive number are skipped. With no usable `fieldTeams`,
 * the legacy single `number` / `name` is the one team (no team number at all reads as an empty list).
 */
export function readFieldTeams(doc: Pick<FtcTeamDoc, "fieldTeams" | "number" | "name"> | null | undefined): FtcFieldTeam[] {
  if (!doc) return [];
  if (Array.isArray(doc.fieldTeams)) {
    const out: FtcFieldTeam[] = [];
    for (const raw of doc.fieldTeams) {
      if (!isRecord(raw)) continue;
      const id = nonEmptyString(raw.id);
      const number = numberFrom(raw.number);
      if (id && number > 0) out.push({ id, number, name: str(raw.name).trim() });
    }
    if (out.length > 0) return out;
  }
  const number = numberFrom(doc.number);
  return number > 0 ? [{ id: migratedFieldTeamId(number), number, name: str(doc.name).trim() }] : [];
}

/** A stored event (the denormalized copy on the team doc) as `EventInfo`. Null without a code. A missing season reads as 0, a bad status as "upcoming". */
export function readStoredEvent(value: unknown): EventInfo | null {
  if (!isRecord(value)) return null;
  const code = nonEmptyString(value.code);
  if (!code) return null;
  return {
    code,
    season: finiteNumber(value.season) ?? 0,
    name: str(value.name).trim() || code,
    dateStart: str(value.dateStart),
    dateEnd: str(value.dateEnd),
    city: nonEmptyString(value.city),
    stateProv: nonEmptyString(value.stateProv),
    country: nonEmptyString(value.country),
    venue: nonEmptyString(value.venue),
    website: nonEmptyString(value.website),
    timezone: nonEmptyString(value.timezone),
    status: EVENT_STATUSES.find((status) => status === value.status) ?? "upcoming",
  };
}

function readActiveForms(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [season, formId] of Object.entries(value)) if (typeof formId === "string") out[season] = formId;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Reads `programs/ftc/teams/{id}` as the app's `TeamDoc`. `id` is the team's document id (it doubles as `joinCode` when the doc has none). */
export function ftcTeamToTeamDoc(id: string, doc: FtcTeamDoc): TeamDoc {
  const first = readFieldTeams(doc)[0];
  const listed = Array.isArray(doc.activeEvents) ? doc.activeEvents.map(readStoredEvent).filter((event): event is EventInfo => event !== null) : [];
  const single = readStoredEvent(doc.activeEvent);
  const events = listed.length > 0 ? listed : single ? [single] : [];
  const primaryCode = nonEmptyString(doc.activeEventCode) ?? single?.code ?? events[0]?.code ?? null;
  // `activeEvent` is the event for `activeEventCode`, never a different one: a code with no stored event leaves it null.
  const primary = primaryCode ? (events.find((event) => event.code === primaryCode) ?? (single?.code === primaryCode ? single : null)) : null;

  const storedCodes = stringList(doc.activeEventCodes);
  const codes = storedCodes.length > 0 ? storedCodes : events.map((event) => event.code);
  if (primaryCode && !codes.includes(primaryCode)) codes.unshift(primaryCode);

  const activeForms = readActiveForms(doc.activeForms);
  const accountName = nonEmptyString(doc.accountName);
  const ownerUid = nonEmptyString(doc.ownerUid);

  const accountTeams = readFieldTeams(doc).map((t): AccountTeam => ({ id: t.id, number: t.number, name: t.name || null }));

  const team: TeamDoc = {
    number: first?.number ?? 0,
    name: first?.name || null,
    ...(accountTeams.length > 0 ? { accountTeams } : {}),
    joinCode: nonEmptyString(doc.joinCode) ?? id,
    ...(ownerUid ? { ownerUid } : {}),
    ...(doc.pendingTransfer !== undefined && doc.pendingTransfer !== null ? { pendingTransfer: doc.pendingTransfer } : {}),
    ...(accountName ? { accountName } : {}),
    ...(activeForms ? { activeForms } : {}),
    activeEventCode: primaryCode,
    activeSeasonId: finiteNumber(doc.activeSeasonId) ?? primary?.season ?? null,
    activeEvent: primary,
    activeEventCodes: codes,
    activeEvents: events,
    ...(typeof doc.usePlaceholderVideo === "boolean" ? { usePlaceholderVideo: doc.usePlaceholderVideo } : {}),
    ...(typeof doc.changelogSeeded === "boolean" ? { changelogSeeded: doc.changelogSeeded } : {}),
    ...(typeof doc.libraryBackfilled === "boolean" ? { libraryBackfilled: doc.libraryBackfilled } : {}),
  };
  return team;
}

/**
 * What is written to `programs/ftc/teams/{id}` for an active-event selection: the primary event (always the FIRST: the rules check
 * `activeEventCodes[0] === activeEventCode`), its code and season, the list of codes, and the full event records, so every reader gets complete events
 * without a second lookup. A selection handed in with its primary elsewhere is written with that event moved to the front; an empty one clears all five.
 */
export function ftcActiveEventsFields(state: ActiveEventsState): {
  activeEventCode: string | null;
  activeSeasonId: number | null;
  activeEvent: EventInfo | null;
  activeEventCodes: string[];
  activeEvents: EventInfo[];
} {
  const events = orderPrimaryFirst(state);
  const primary = events[0] ?? null;
  return stripUndefined({
    activeEventCode: primary?.code ?? null,
    activeSeasonId: primary?.season ?? null,
    activeEvent: primary,
    activeEventCodes: events.map((e) => e.code),
    activeEvents: events,
  });
}

// My Scouting filter options (Session 5). Every filter on the page offers only what applies to the signed-in person:
// the roles they hold (or held, per their own entries), the events they attended or scouted, the games they scouted
// plus the current one. Pure (no React, no Firebase), shared by both programs: the program supplies data and config only
// (event-key shape, seasons, the person's profile and attendance), never a program id.
//
// Options come from the person's WHOLE dataset, never from the currently filtered subset, so a choice does not disappear
// while another filter narrows the list. A filter with fewer than two real options is hidden (the Game select is the one
// exception: one game shows disabled, with its name).

import { canonicalEventKey, seasonOfEventKey, type EventKeyShape } from "@/lib/events/event-key";
import { withEventYear } from "@/lib/events/names";
import { userRoles } from "@/lib/dashboard/roles";
import { gameSeasonId } from "@/lib/scout-stats/game-filter";
import { getRole, isRoleId, sortRolesCanonical, type RoleId } from "@/lib/roles";

/** The part of an entry the helper reads. */
export type FilterEntry = { uid: string; source: string; eventCode: string; submittedAt?: string; game?: unknown };
/** The part of a practice session the helper reads (the page filters sessions by their `game`). */
export type FilterSession = { uid: string; game?: unknown };
/** The part of an attendance record the helper reads. */
export type FilterAttendance = { eventCode: string; uids: readonly string[] };
export type FilterProfile = { primaryRole?: unknown; secondaryRoles?: unknown } | null | undefined;

export type RoleOption = { id: RoleId; label: string };
export type EventOption = {
  /** The canonical key (one spelling per event): what the filter holds. */
  key: string;
  /** Every stored spelling of the event the person's data uses (attendance keys and entry codes), so a filter can still match stored data. */
  rawKeys: string[];
  /** The name with its year ("Bayou Regional 2026"). */
  label: string;
  archived: boolean;
  /** `label`, plus " (Archived)" for an archived event: for chips and select items. */
  displayLabel: string;
};
export type GameOption = { id: string; name: string };

export type MyScoutingFilterOptions = {
  roles: RoleOption[];
  events: EventOption[];
  games: GameOption[];
  /** Role chips show only with two or more roles. */
  showRole: boolean;
  /** Event chips show only with two or more events. */
  showEvent: boolean;
  /** True when the person has no entry or session at all (the page shows its empty state, not empty dropdowns). */
  noData: boolean;
};

export type MyScoutingFilterInput = {
  uid: string;
  /** Any entries: the helper keeps the person's own by `uid` (the read stays team-wide). */
  entries: readonly FilterEntry[];
  sessions?: readonly FilterSession[];
  profile: FilterProfile;
  attendance: readonly FilterAttendance[];
  /** `ProgramConfig.event.keyShape`. */
  keyShape: EventKeyShape;
  /** The program's games and its current one. */
  seasons: readonly GameOption[];
  defaultSeasonId: string;
  /** The game an entry with no (or an unknown) `game` counts as. */
  fallbackSeasonId: string;
  /** Event codes the team archived (any spelling). */
  archivedEventCodes?: readonly string[];
  /** The event's own name for a stored key (API, stored or static name); the key itself when unknown. */
  eventName?: (key: string) => string | null | undefined;
};

const isRealEntry = (e: FilterEntry) => e.source === "event" || e.source === "live";

/**
 * The role an entry evidences. `scoutEntries` hold only Match Scout form entries (the other forms live in `formEntries`, which this page does not
 * read), and a game's alliance role (a per-match assignment, not something the account holds) is not an account role, so any own entry shows a Match Scout.
 */
const ENTRY_ROLE: RoleId = "match-scout";

/** The roles the person holds now (primary first, through the shared `userRoles` accessor) plus the roles their own entries show, in canonical order. */
export function personRoles(profile: FilterProfile, hasOwnEntries: boolean): RoleId[] {
  const primary = isRoleId(profile?.primaryRole) ? (profile!.primaryRole as RoleId) : null;
  const secondary = Array.isArray(profile?.secondaryRoles) ? (profile!.secondaryRoles as unknown[]).filter(isRoleId) : [];
  const held = primary ? userRoles(primary, secondary) : secondary;
  return sortRolesCanonical([...held, ...(hasOwnEntries ? [ENTRY_ROLE] : [])]);
}

export function deriveMyScoutingFilterOptions(input: MyScoutingFilterInput): MyScoutingFilterOptions {
  const { uid, keyShape } = input;
  const own = input.entries.filter((e) => e.uid === uid);
  const ownSessions = (input.sessions ?? []).filter((s) => s.uid === uid);
  const canon = (key: string) => canonicalEventKey(keyShape, key);

  // Roles.
  const roles = personRoles(input.profile, own.length > 0).map((id) => ({ id, label: getRole(id).label }));

  // Events: attended (attendance lists) plus scouted (event and live entries; practice entries name no real event).
  type Acc = { rawKeys: Set<string>; latest: string };
  const byKey = new Map<string, Acc>();
  const touch = (raw: string, submittedAt = "") => {
    const trimmed = String(raw ?? "").trim();
    if (!trimmed) return;
    const key = canon(trimmed);
    const acc = byKey.get(key) ?? { rawKeys: new Set<string>(), latest: "" };
    acc.rawKeys.add(trimmed);
    if (submittedAt > acc.latest) acc.latest = submittedAt;
    byKey.set(key, acc);
  };
  for (const a of input.attendance) if (a.uids.includes(uid)) touch(a.eventCode);
  for (const e of own) if (isRealEntry(e)) touch(e.eventCode, e.submittedAt ?? "");

  const archived = new Set((input.archivedEventCodes ?? []).map(canon));
  const events: EventOption[] = [...byKey.entries()]
    .map(([key, acc]) => {
      const name = (input.eventName?.(key) ?? input.eventName?.([...acc.rawKeys][0]) ?? "").toString().trim() || key;
      const label = withEventYear(name, key);
      const isArchived = archived.has(key);
      return { key, rawKeys: [...acc.rawKeys], label, archived: isArchived, displayLabel: isArchived ? `${label} (Archived)` : label, latest: acc.latest, season: seasonOfEventKey(keyShape, key) };
    })
    // Newest first: season (a key with none last), then the latest entry, then the key.
    .sort((a, b) => (b.season ?? -1) - (a.season ?? -1) || b.latest.localeCompare(a.latest) || b.key.localeCompare(a.key))
    .map(({ key, rawKeys, label, archived: isArchived, displayLabel }) => ({ key, rawKeys, label, archived: isArchived, displayLabel }));

  // Games: those the person scouted (entries and practice sessions), plus the program's current game, in the program's order.
  const seasonIds = input.seasons.map((s) => s.id);
  const present = new Set<string>([input.defaultSeasonId]);
  for (const e of own) present.add(gameSeasonId(e.game, seasonIds, input.fallbackSeasonId));
  for (const s of ownSessions) present.add(gameSeasonId(s.game, seasonIds, input.fallbackSeasonId));
  const games = input.seasons.filter((s) => present.has(s.id));

  return { roles, events, games, showRole: roles.length >= 2, showEvent: events.length >= 2, noData: own.length === 0 && ownSessions.length === 0 };
}

/** A multi-select value kept only while it is still one of the options; a stale one drops out (the filter reads as "All"). Same array back when nothing changes. */
export function keepValid<T>(selected: readonly T[], valid: readonly T[]): T[] {
  const ok = selected.filter((v) => valid.includes(v));
  return ok.length === selected.length ? (selected as T[]) : ok;
}

/** Canonical event keys the person picked, as the stored spellings the stats engine compares (it matches attendance and entry codes exactly). */
export function storedEventKeys(selected: readonly string[], events: readonly EventOption[]): string[] {
  return [...new Set(selected.flatMap((key) => events.find((e) => e.key === key)?.rawKeys ?? [key]))];
}

/** The one stored spelling the engine's single-event calculation compares: the canonical key when the data uses it, else the first spelling the data uses. */
export function storedEventKey(key: string, events: readonly EventOption[]): string {
  const raw = events.find((e) => e.key === key)?.rawKeys ?? [];
  return raw.includes(key) ? key : (raw[0] ?? key);
}

/**
 * The game to apply. A stored or URL value that is not one of the person's options falls back to `fallback` (the program's current game, what the page
 * shows with no choice made); "" (every game) stays valid while the person has two or more games. With one game, that game.
 */
export function effectiveGame(value: string, games: readonly GameOption[], fallback: string): string {
  if (games.length <= 1) return games[0]?.id ?? fallback;
  if (value === "") return "";
  return games.some((g) => g.id === value) ? value : games.some((g) => g.id === fallback) ? fallback : games[0].id;
}

import { canonicalEventKey, seasonOfEventKey, type EventKeyShape } from "@/lib/events/event-key";

// Read-only attendance audit (scripts/audit-event-attendance.ts): why is one person listed for an event? Pure: it takes what the
// script read and returns evidence, never a verdict on who clicked what. Nothing here reads or writes Firestore.

export type AuditAttendanceRow = { rawKey: string; listed: string[] };
export type AuditEntrySource = "event" | "live" | "practice" | "other";
export type AuditEntryRow = { id: string; rawEventKey: string; source: AuditEntrySource; excluded: boolean; teamId: string | null };
export type AuditMember = { uid: string; name: string };

export type AuditInput = {
  uid: string;
  personName: string | null;
  teamId: string;
  shape: EventKeyShape;
  season: number;
  attendance: AuditAttendanceRow[];
  members: AuditMember[];
  entries: AuditEntryRow[];
};

export type EntryCounts = { event: number; live: number; practice: number; other: number; excluded: number };

export type AuditEvent = {
  key: string;
  season: number | null;
  inSeason: boolean;
  /** Every stored spelling of this event's key that lists the person (alias and case variants fold into one event). */
  rawKeys: string[];
  matchedBy: ("uid" | "name")[];
  /** Other members with the same display name: a name entry cannot tell them apart. */
  sameNameMembers: string[];
  listSize: number;
  /** Listed entries that resolve to a current member, over the roster size (null with no roster). */
  rosterShare: number | null;
  entries: EntryCounts;
  /** What the profile card counts for this event: event and live entries that are not excluded. */
  counted: number;
};

export type AuditReport = {
  uid: string;
  teamId: string;
  season: number;
  events: AuditEvent[];
  listedWithoutEntries: string[];
  entriesWithoutAttendance: { key: string; entries: EntryCounts }[];
  outsideSeason: string[];
  hints: string[];
};

const norm = (s: string) => s.trim().toLowerCase();
const emptyCounts = (): EntryCounts => ({ event: 0, live: 0, practice: 0, other: 0, excluded: 0 });

function countEntries(entries: readonly AuditEntryRow[]): EntryCounts {
  const c = emptyCounts();
  for (const e of entries) {
    if (e.excluded) c.excluded += 1;
    else c[e.source] += 1;
  }
  return c;
}

export function auditEventAttendance(input: AuditInput): AuditReport {
  const { uid, shape, season } = input;
  const name = input.personName ? norm(input.personName) : null;
  const sameNameMembers = name ? input.members.filter((m) => m.uid !== uid && norm(m.name) === name).map((m) => m.uid) : [];
  const byUid = new Set(input.members.map((m) => m.uid));
  const byName = new Set(input.members.map((m) => norm(m.name)));

  // Group attendance rows by canonical key (alias and case variants are one event).
  const byKey = new Map<string, AuditAttendanceRow[]>();
  for (const row of input.attendance) {
    const key = canonicalEventKey(shape, row.rawKey);
    byKey.set(key, [...(byKey.get(key) ?? []), row]);
  }

  const entriesByKey = new Map<string, AuditEntryRow[]>();
  for (const e of input.entries) {
    const key = canonicalEventKey(shape, e.rawEventKey);
    entriesByKey.set(key, [...(entriesByKey.get(key) ?? []), e]);
  }

  const events: AuditEvent[] = [];
  for (const [key, rows] of byKey) {
    const matchedBy = new Set<"uid" | "name">();
    for (const row of rows) {
      for (const item of row.listed) {
        if (item.trim() === uid) matchedBy.add("uid");
        else if (name && norm(item) === name) matchedBy.add("name");
      }
    }
    if (matchedBy.size === 0) continue; // the person is not on this event's list
    const listedAll = [...new Set(rows.flatMap((r) => r.listed.map((x) => x.trim()).filter(Boolean)))];
    const resolved = listedAll.filter((x) => byUid.has(x) || byName.has(norm(x)));
    const entryCounts = countEntries(entriesByKey.get(key) ?? []);
    const eventSeason = seasonOfEventKey(shape, key);
    events.push({
      key,
      season: eventSeason,
      inSeason: eventSeason === season,
      rawKeys: [...new Set(rows.map((r) => r.rawKey))],
      matchedBy: [...matchedBy],
      sameNameMembers: matchedBy.has("name") ? sameNameMembers : [],
      listSize: listedAll.length,
      rosterShare: input.members.length > 0 ? resolved.length / input.members.length : null,
      entries: entryCounts,
      counted: entryCounts.event + entryCounts.live,
    });
  }
  events.sort((a, b) => a.key.localeCompare(b.key));

  const listedKeys = new Set(events.map((e) => e.key));
  const entriesWithoutAttendance = [...entriesByKey]
    .filter(([key]) => !listedKeys.has(key))
    .map(([key, rows]) => ({ key, entries: countEntries(rows) }))
    .sort((a, b) => a.key.localeCompare(b.key));

  const hints: string[] = [];
  for (const e of events) {
    if (e.matchedBy.length === 1 && e.matchedBy[0] === "name") hints.push(`${e.key}: listed by display name only (older data); the list cannot show who was meant${e.sameNameMembers.length ? `, and ${e.sameNameMembers.length} other member(s) share this name` : ""}.`);
    if (e.rosterShare !== null && input.members.length >= 5 && e.rosterShare >= 0.8) hints.push(`${e.key}: the list covers ${Math.round(e.rosterShare * 100)}% of the roster, which looks like a bulk selection rather than who attended.`);
    if (e.counted === 0 && e.entries.practice > 0) hints.push(`${e.key}: only practice entries exist for it (practice is not counted).`);
    if (!e.inSeason) hints.push(`${e.key}: season ${e.season ?? "unknown"}, outside ${season}; the profile card no longer shows it.`);
  }
  for (const x of entriesWithoutAttendance) if (x.entries.event + x.entries.live > 0) hints.push(`${x.key}: real entries exist but the person is not on its list (the card does not show it).`);

  return {
    uid,
    teamId: input.teamId,
    season,
    events,
    listedWithoutEntries: events.filter((e) => e.counted === 0).map((e) => e.key),
    entriesWithoutAttendance,
    outsideSeason: events.filter((e) => !e.inSeason).map((e) => e.key),
    hints,
  };
}

const fmtCounts = (c: EntryCounts) => `event ${c.event}, live ${c.live}, practice ${c.practice}, other ${c.other}, excluded ${c.excluded}`;

/** Plain text for the terminal. Prints the person's uid and team id only; no emails or tokens are ever read. */
export function formatAuditReport(r: AuditReport): string {
  const out: string[] = [`Attendance audit: uid ${r.uid}, team ${r.teamId}, season ${r.season}`, ""];
  out.push(`Events whose list contains this person: ${r.events.length}`);
  for (const e of r.events) {
    const spelled = e.rawKeys.length === 1 && e.rawKeys[0] === e.key ? e.key : `${e.key} (stored as ${e.rawKeys.join(", ")})`;
    const share = e.rosterShare === null ? "" : `, ${Math.round(e.rosterShare * 100)}% of roster`;
    out.push(`  ${spelled} | ${e.inSeason ? "in season" : `season ${e.season ?? "?"}, OUTSIDE ${r.season}`} | by ${e.matchedBy.join("+")} | list of ${e.listSize}${share} | counted ${e.counted} (${fmtCounts(e.entries)})`);
  }
  out.push("", `Listed but nothing counted (the card shows 0 entries): ${r.listedWithoutEntries.join(", ") || "none"}`);
  out.push(`Entries with no attendance record for this person: ${r.entriesWithoutAttendance.map((x) => `${x.key} (${fmtCounts(x.entries)})`).join("; ") || "none"}`);
  out.push(`Listed outside season ${r.season}: ${r.outsideSeason.join(", ") || "none"}`);
  out.push("", "Evidence for why a person is listed (a list does not record who edited it):");
  for (const h of r.hints.length ? r.hints : ["nothing unusual in the stored lists: check who saved attendance for those events in the Assignments page history."]) out.push(`  - ${h}`);
  return out.join("\n");
}

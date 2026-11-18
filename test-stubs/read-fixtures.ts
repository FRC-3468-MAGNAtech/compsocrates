// Synthetic Firestore contents for the read characterization tests and the query-count harness. NOT production data: the sizes are stand-ins the tests
// choose, and every number the harness prints is for the dataset built here.
import { rebuiltDoc } from "@/lib/analytics/cs-test-fixtures";
import { seed } from "./fake-firestore";

export const TEAM = "T1";
export const OTHER_TEAM = "T2";
export const EVENT = "2026arli";

export type Scale = {
  members: number;
  /** Entries stamped with the team. */
  entries: number;
  /** Old rows with an EMPTY teamId, written by team members (the legacy fallback keeps these). */
  legacyRows?: number;
  /** Rows written by the same people while on ANOTHER team: the fallback's `in` queries return them and the client discards them. */
  otherTeamRows?: number;
  flagStates?: number;
  /** Live sessions by team members (any status). */
  liveSessions?: number;
  soloSessions?: number;
  libraryMatches?: number;
};

export const memberId = (i: number) => `u${i}`;
export const memberName = (i: number) => `Scout ${i}`;

export function seedDataset(s: Scale, team: string = TEAM): void {
  for (let i = 0; i < s.members; i += 1) seed(`users/${memberId(i)}`, { teamId: team, displayName: memberName(i), role: "match-scout" });
  const row = (n: number, over: Record<string, unknown>) => {
    const who = n % s.members;
    return { ...rebuiltDoc({ match: `q${(n % 80) + 1}`, team: String(1000 + (n % 6)), event: EVENT, scout: memberName(who), submittedAt: 1_700_000_000_000 + n }), scoutId: memberId(who), ...over };
  };
  for (let n = 0; n < s.entries; n += 1) seed(`scouting/e${n}`, row(n, { teamId: team }));
  for (let n = 0; n < (s.legacyRows ?? 0); n += 1) seed(`scouting/old${n}`, row(n, { teamId: "" }));
  for (let n = 0; n < (s.otherTeamRows ?? 0); n += 1) seed(`scouting/x${n}`, row(n, { teamId: OTHER_TEAM }));
  for (let n = 0; n < (s.flagStates ?? 0); n += 1) seed(`scoutingFlagStates/scoutingEntry:e${n}`, { teamId: team, entityType: "scoutingEntry", entityId: `e${n}`, manualFlagged: true });
  for (let n = 0; n < (s.liveSessions ?? 0); n += 1) {
    const who = n % s.members;
    seed(`practiceSessions/live${n}`, { teamId: team, uid: memberId(who), scoutId: memberId(who), scoutName: memberName(who), kind: "live", status: "completed", accuracy: n % 3 === 0 ? null : 80, startedAt: 1_700_000_000_000 + n, matchType: "Qualification", matchNumber: n + 1 });
  }
  for (let n = 0; n < (s.soloSessions ?? 0); n += 1) {
    const who = n % s.members;
    seed(`practiceSessions/solo${n}`, { teamId: team, uid: memberId(who), scoutId: memberId(who), scoutName: memberName(who), kind: "solo", status: "completed", accuracy: 70 + (n % 20), startedAt: 1_700_000_000_000 + n });
  }
  for (let n = 0; n < (s.libraryMatches ?? 0); n += 1) seed(`libraryMatches/m${n}`, { eventCode: `2026ev${n % 20}`, seasonId: "rebuilt", matchType: "qualification", matchNumber: n + 1, published: true, origin: "api" });
}

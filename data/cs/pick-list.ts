/**
 * Adapter between CS's `teams/{TEAMCODE}.pickList` and CE's ordered list of team numbers (lib/pick-list). D1, D10. No React, no Firebase.
 *
 * CS (app/analytics/pick-list/page.tsx) keeps ONE pick list per team, not per event:
 *   `pickList: { picks: [{ teamNumber: "254", pickOrder: 1 }, ...], updatedAt: <epoch ms>, updatedBy: <uid> }`
 * written with `setDoc(teams/{id}, { pickList }, { merge: true })`. CE's board is per event (`pickLists/{teamId}_{eventCode}`); the
 * rebuild persists the team's single list for whichever event the board shows, as CS does.
 */
import type { CsRecord } from "@/data/cs/types";
import { digitsToNumber, isRecord, toEpochMs } from "@/data/cs/util";

/** `teams/{id}.pickList` as CS writes it. */
export type CsPickListDoc = {
  picks?: Array<{ teamNumber?: string | number; pickOrder?: number; [key: string]: unknown }>;
  updatedAt?: number;
  updatedBy?: string;
  [key: string]: unknown;
};

/** The picks of a stored `pickList` as team numbers in priority order (by `pickOrder`, then stored order; duplicates and non-teams dropped). */
export function csPickListToPicked(raw: unknown): number[] {
  if (!isRecord(raw) || !Array.isArray(raw.picks)) return [];
  const rows = raw.picks
    .map((pick, index) => {
      const record = isRecord(pick) ? pick : {};
      const order = Number(record.pickOrder);
      return { team: digitsToNumber(record.teamNumber), order: Number.isFinite(order) && order > 0 ? order : index + 1, index };
    })
    .filter((r) => r.team > 0)
    .sort((a, b) => a.order - b.order || a.index - b.index);
  const seen = new Set<number>();
  const out: number[] = [];
  for (const r of rows) {
    if (seen.has(r.team)) continue;
    seen.add(r.team);
    out.push(r.team);
  }
  return out;
}

/** Who edited and when, from the stored `pickList` (CS keeps the uid only, never a display name). */
export function csPickListMeta(raw: unknown): { updatedBy: string | null; updatedAtMs: number | null } {
  if (!isRecord(raw)) return { updatedBy: null, updatedAtMs: null };
  const by = typeof raw.updatedBy === "string" && raw.updatedBy ? raw.updatedBy : null;
  const at = toEpochMs(raw.updatedAt);
  return { updatedBy: by, updatedAtMs: at > 0 ? at : null };
}

/**
 * The `pickList` value to merge-write for `picked`: CS's shape (`teamNumber` as a string, 1-based `pickOrder`, `updatedAt` in ms,
 * `updatedBy` uid). Fields of the stored list this adapter does not know are carried over, including extra fields on an
 * existing pick of the same team (D10).
 */
export function pickedToCsPickList(existing: unknown, picked: readonly number[], actorUid: string, now: number): CsRecord {
  const previous = isRecord(existing) ? existing : {};
  const extras = new Map<number, CsRecord>();
  if (Array.isArray(previous.picks)) {
    for (const pick of previous.picks) {
      if (!isRecord(pick)) continue;
      const team = digitsToNumber(pick.teamNumber);
      if (team > 0 && !extras.has(team)) extras.set(team, pick);
    }
  }
  return {
    ...previous,
    picks: picked.map((team, index) => ({ ...(extras.get(team) ?? {}), teamNumber: String(team), pickOrder: index + 1 })),
    updatedAt: now,
    updatedBy: actorUid,
  };
}

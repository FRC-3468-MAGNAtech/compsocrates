/**
 * Adapter between an FTC `programs/ftc/pickLists/{teamId}_{eventCode}` document (the shared pick list board of one event) and the app's `PickListDoc`
 * (lib/pick-list/store.ts). No React, no Firebase. One doc per team and event, written whole with who edited it and when.
 */
import { sanitizePicks } from "@/lib/pick-list/ops";
import type { PickListDoc } from "@/lib/pick-list/store";
import { nonEmptyString, str, toEpochMs } from "@/data/ftc/util";

/** The id of a pick list doc: `{teamId}_{eventCode}`. */
export const ftcPickListId = (teamId: string, eventCode: string): string => `${teamId}_${eventCode}`;

/** Reads a stored pick list. Null when the doc has no list of picks to show (it was never written). The picks are cleaned: whole positive team numbers, no repeats. */
export function ftcDocToPickList(doc: Record<string, unknown>): PickListDoc {
  const updatedAtMs = toEpochMs(doc.updatedAt);
  return {
    teamId: str(doc.teamId),
    eventCode: str(doc.eventCode),
    picked: sanitizePicks(doc.picked),
    updatedBy: nonEmptyString(doc.updatedBy),
    updatedByName: nonEmptyString(doc.updatedByName),
    updatedAtMs: updatedAtMs > 0 ? updatedAtMs : null,
  };
}

/** What is stored for a list: the picks in priority order, who edited it (the rules need the editor's own uid and a name) and the server time. */
export function ftcPickListDoc(ctx: { teamId: string; eventCode: string; uid: string; name: string }, picked: readonly number[], now: () => unknown): Record<string, unknown> {
  return { teamId: ctx.teamId, eventCode: ctx.eventCode, picked: [...picked], updatedBy: ctx.uid, updatedByName: ctx.name, updatedAt: now() };
}

import { isSlotId } from "@/config/alliance";
import type { MatchType } from "@/lib/events/types";
import type { ScheduleSlot, SlotId } from "./types";

const MATCH_TYPES: readonly string[] = ["Practice", "Qualification", "Playoff"];

/**
 * Reads a stored `current.slots` array. The model is unchanged from the 2-robot
 * app: an older doc holds only red1/red2/blue1/blue2, a 3-robot doc adds
 * red3/blue3, and both read through here (any `<red|blue><n>` slot id is kept;
 * malformed rows are dropped rather than crashing a page that renders them).
 */
export function parseScheduleSlots(raw: unknown): ScheduleSlot[] {
  if (!Array.isArray(raw)) return [];
  const slots: ScheduleSlot[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;
    if (typeof s.matchType !== "string" || !MATCH_TYPES.includes(s.matchType)) continue;
    if (typeof s.matchNumber !== "number" || typeof s.teamNumber !== "number") continue;
    if (!isSlotId(s.slot)) continue;
    slots.push({
      matchType: s.matchType as MatchType,
      matchNumber: s.matchNumber,
      slot: s.slot as SlotId,
      teamNumber: s.teamNumber,
      scoutUid: typeof s.scoutUid === "string" ? s.scoutUid : null,
    });
  }
  return slots;
}

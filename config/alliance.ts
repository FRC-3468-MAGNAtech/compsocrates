// Alliance size: robots per alliance (FRC = 3). Every place that needs the size reads this file; the value itself
// is the config constant EVENT_CONFIG.allianceSize. Keep this file tiny.

import { EVENT_CONFIG } from "./event";

export type AllianceColor = "red" | "blue";

export const ALLIANCE_SIZE: number = EVENT_CONFIG.allianceSize;

export const ALLIANCE_COLORS: readonly AllianceColor[] = ["red", "blue"];

/** Every slot id, red first: size 3 gives `["red1","red2","red3","blue1","blue2","blue3"]`. */
export function allianceSlots(size: number = ALLIANCE_SIZE): string[] {
  return ALLIANCE_COLORS.flatMap((color) => Array.from({ length: size }, (_, i) => `${color}${i + 1}`));
}

const SLOT_PATTERN = /^(red|blue)([1-9])$/;

/** Is `value` a well-formed slot id ("red1", "blue3", ...)? Any index is accepted so a stored legacy or larger-alliance doc still reads. */
export function isSlotId(value: unknown): value is string {
  return typeof value === "string" && SLOT_PATTERN.test(value);
}

/** The alliance a slot belongs to, or null for a malformed id. */
export function slotAlliance(slot: string): AllianceColor | null {
  const m = SLOT_PATTERN.exec(slot);
  return m ? (m[1] as AllianceColor) : null;
}

/** The 0-based position of a slot within its alliance ("red1" is 0), or -1 for a malformed id. */
export function slotIndex(slot: string): number {
  const m = SLOT_PATTERN.exec(slot);
  return m ? Number(m[2]) - 1 : -1;
}

/** "red", 0 -> "red1". */
export function slotId(color: AllianceColor, index: number): string {
  return `${color}${index + 1}`;
}

/** "Red 1", "Blue 3", or the raw id for a malformed one. */
export function slotLabel(slot: string): string {
  const color = slotAlliance(slot);
  if (!color) return slot;
  return `${color === "red" ? "Red" : "Blue"} ${slotIndex(slot) + 1}`;
}

/** An alliance's team list is plausible: at least 2 teams (a match with an unposted third robot) and at most the configured size. */
export function isValidAllianceTeams(teams: readonly unknown[], size: number = ALLIANCE_SIZE): boolean {
  return teams.length >= 2 && teams.length <= Math.max(size, 2);
}

/**
 * Small pure helpers shared by the FTC adapters. No React, no Firebase.
 *
 * The generic ones (`isRecord`, `str`, `toEpochMs`, `digitsToNumber`) are the same ones the other adapter uses; they are re-exported here so
 * this folder has a single seam to them and nothing program-specific is shared.
 */
export { digitsToNumber, isRecord, str, toEpochMs } from "@/data/cs/util";

/** A finite number, or null (numeric strings are not numbers here: the FTC schema stores numbers as numbers). */
export function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function numberOr(value: unknown, fallback: number): number {
  return finiteNumber(value) ?? fallback;
}

/** The trimmed string, or null when it is not a string or is blank. */
export function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** The strings of a list, in order; anything else (not a list, non-string items) reads as nothing. */
export function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

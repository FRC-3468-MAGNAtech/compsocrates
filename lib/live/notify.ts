import { ALLIANCE_SIZE } from "@/config/alliance";

export type SubmittedEntry = { uid: string; submittedAt: string };

/**
 * Whether a fully-scouted alliance (exactly one submitted entry per robot)
 * is eligible to notify once scores post — per the prompt: either different
 * scouts each covered one robot, or a scout who covered several (two or
 * three robots of an alliance) submitted them all within
 * `windowMinutes` of each other (in practice, before scores post).
 * Anything else (fewer entries than `allianceSize`, or one scout's entries too
 * far apart) means accuracy can't be meaningfully attributed, so no notify.
 * `allianceSize` is the alliance's actual team count (defaults to the event's).
 */
export function isAllianceReadyToNotify(entries: SubmittedEntry[], windowMinutes: number, allianceSize: number = ALLIANCE_SIZE): boolean {
  if (entries.length !== allianceSize) return false;
  const byUid = new Map<string, number[]>();
  for (const e of entries) byUid.set(e.uid, [...(byUid.get(e.uid) ?? []), new Date(e.submittedAt).getTime()]);
  for (const times of byUid.values()) {
    if (times.length < 2) continue;
    if (Math.max(...times) - Math.min(...times) > windowMinutes * 60 * 1000) return false;
  }
  return true;
}

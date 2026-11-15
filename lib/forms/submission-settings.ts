// Session E: the team's form-submission switches. ADDITIVE field `formSubmissionSettings` on the team doc (both programs), written with a merge write:
//
//   formSubmissionSettings: { enabled: boolean, seasons: { [seasonId]: boolean }, updatedBy?: { uid, name }, updatedAtMs?: number }
//
// A missing field, a missing key and anything unreadable mean ON, so nothing changes on deploy. `enabled: false` closes every form; `seasons.<id>: false` closes one
// game's forms (`rebuilt`, `reefscape`, `charged_up`, `biobuzz`: the program's season ids). Closing a form stops NEW submissions only: the form stays viewable,
// drafts keep saving, and an admin can still edit entries. This is a client-side control (like other team scoping) until the rules are tightened (docs/SECURITY-NOTES.md).
// Pure: no React, no Firebase.

export type FormSubmissionSettings = {
  /** The master switch: false turns submission off for every form. */
  enabled: boolean;
  /** Per season: false closes that season's forms. A season with no key is open. */
  seasons: Record<string, boolean>;
  /** Who last changed it, and when (only when an admin saved it from the app). */
  updatedBy?: { uid: string; name: string };
  updatedAtMs?: number;
};

/** Everything open: what a team with no field (or a broken one) has. */
export const OPEN_SUBMISSION_SETTINGS: FormSubmissionSettings = Object.freeze({ enabled: true, seasons: Object.freeze({}) as Record<string, boolean> }) as FormSubmissionSettings;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The stored field as settings. Only an explicit `false` closes anything; every other value (missing, a string, null) reads as open. */
export function readFormSubmissionSettings(raw: unknown): FormSubmissionSettings {
  if (!isRecord(raw)) return OPEN_SUBMISSION_SETTINGS;
  const seasons: Record<string, boolean> = {};
  if (isRecord(raw.seasons)) for (const [id, value] of Object.entries(raw.seasons)) if (value === false) seasons[id] = false;
  const by = isRecord(raw.updatedBy) && typeof raw.updatedBy.uid === "string" ? { uid: raw.updatedBy.uid, name: typeof raw.updatedBy.name === "string" ? raw.updatedBy.name : "" } : undefined;
  const at = typeof raw.updatedAtMs === "number" && Number.isFinite(raw.updatedAtMs) ? raw.updatedAtMs : undefined;
  return { enabled: raw.enabled !== false, seasons, ...(by ? { updatedBy: by } : {}), ...(at !== undefined ? { updatedAtMs: at } : {}) };
}

/** Why a submission is closed: the master switch, or one season's. */
export type SubmissionBlock = { kind: "all" | "season"; message: string };

export const MASTER_OFF_MESSAGE = "Form submissions are turned off by your team admin";

/** The message a closed season shows ("Submissions for REEFSCAPE are turned off by your team admin"). */
export const seasonOffMessage = (gameName: string): string => `Submissions for ${gameName} are turned off by your team admin`;

/** Is a NEW submission allowed for this season? (`seasonId` null or unknown: only the master switch applies.) */
export function isSubmissionOpen(settings: FormSubmissionSettings | null | undefined, seasonId?: string | null): boolean {
  const s = settings ?? OPEN_SUBMISSION_SETTINGS;
  if (!s.enabled) return false;
  return !(seasonId && s.seasons[seasonId] === false);
}

/** The reason a new submission is closed, or null when it is open. `gameName` is the season's label for the message (falls back to the season id). */
export function submissionBlock(settings: FormSubmissionSettings | null | undefined, seasonId?: string | null, gameName?: string): SubmissionBlock | null {
  const s = settings ?? OPEN_SUBMISSION_SETTINGS;
  if (!s.enabled) return { kind: "all", message: MASTER_OFF_MESSAGE };
  if (seasonId && s.seasons[seasonId] === false) return { kind: "season", message: seasonOffMessage(gameName || seasonId) };
  return null;
}

/**
 * The settings after an admin flips the master switch (`{ enabled }`) or one season (`{ seasonId, open }`). Seasons are stored as explicit `true`/`false`
 * so a merge write overwrites the old value; the actor and time ride along.
 */
export function withSubmissionChange(
  current: FormSubmissionSettings,
  change: { enabled: boolean } | { seasonId: string; open: boolean },
  actor: { uid: string; name: string },
  nowMs: number
): FormSubmissionSettings {
  const next: FormSubmissionSettings = { enabled: current.enabled, seasons: { ...current.seasons }, updatedBy: { uid: actor.uid, name: actor.name }, updatedAtMs: nowMs };
  if ("enabled" in change) next.enabled = change.enabled;
  else next.seasons[change.seasonId] = change.open;
  return next;
}

/** The merge-write payload: seasons that are open are written `true` where they were closed before (so the old `false` is replaced), never dropped. */
export function settingsForWrite(next: FormSubmissionSettings, previous: FormSubmissionSettings, seasonIds: readonly string[]): FormSubmissionSettings {
  const seasons: Record<string, boolean> = {};
  for (const id of new Set([...seasonIds, ...Object.keys(previous.seasons), ...Object.keys(next.seasons)])) seasons[id] = next.seasons[id] !== false;
  return { ...next, seasons };
}

/** Thrown by the shared write path when a new submission is closed. The form shows `message`; the typed data stays on screen. */
export class SubmissionClosedError extends Error {
  readonly block: SubmissionBlock;
  constructor(block: SubmissionBlock) {
    super(block.message);
    this.name = "SubmissionClosedError";
    this.block = block;
  }
}

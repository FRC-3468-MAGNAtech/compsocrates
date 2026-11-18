// Account deletion (memberships build 4): the constants the browser and the server both need. NO server imports here.

/** What every kept row says in place of the person's name. */
export const DELETED_ACCOUNT_NAME = "Deleted Account";

/** An opaque id is `deleted-` plus 32 lowercase hex characters (128 random bits). A real Firebase uid has no hyphen, so the two can never collide. */
export const OPAQUE_ID_PREFIX = "deleted-";
const OPAQUE_ID_RE = /^deleted-[0-9a-f]{32}$/;

export function isDeletedAccountId(value: unknown): value is string {
  return typeof value === "string" && OPAQUE_ID_RE.test(value);
}

/** The cooldown before anything is rewritten: an ID token issued just before the account was disabled stays valid for up to an hour. */
export const COOLDOWN_MS = 70 * 60 * 1000;
/** How many times the final sweep may find a late write and send the job back to rewrite and delete before the job is marked `stalled`. */
export const MAX_SWEEP_LOOPS = 3;

/** Per run budgets (documents written / documents read). The owner can lower the writes with `appSettings/global.accountDeletionRunBudget`. */
export const DEFAULT_RUN_WRITES = 3_000;
export const MAX_RUN_WRITES = 10_000;
export const DEFAULT_RUN_READS = 4_000;

/** The job statuses an owner sees. */
export const DELETION_STATUSES = ["running", "cooldown", "stalled"] as const;
export type DeletionStatus = (typeof DELETION_STATUSES)[number];

/** The steps, in order. The tab shows the current one. */
export const DELETION_STEPS = ["disable", "cooldown", "rewrite", "memberships", "delete", "avatars", "sweep", "auth", "finish"] as const;
export type DeletionStep = (typeof DELETION_STEPS)[number];

/** The typed confirmation the dialog asks for. */
export const DELETE_CONFIRMATION_WORD = "DELETE";

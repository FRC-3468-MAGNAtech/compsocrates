/**
 * Types for CompSocrates's Firestore documents as they exist in production (docs/ROUTES.md D1, D10).
 * Pure types only: no React, no Firebase imports. A CS document is read as `CsRecord` (an open map), because
 * production data carries fields this adapter does not understand and every writer must pass them through (D10).
 */

/** A raw Firestore document body (`snap.data()`), keys and values untouched. */
export type CsRecord = Record<string, unknown>;

/** What a row of CS's `scouting` collection is (mirrors CS `entryMatchesAnalyticsFilters` + `isPracticeScoutedEntry`). */
export type CsRowKind =
  /** An official match-scout entry (REBUILT, REEFSCAPE or CHARGED_UP). Includes event practice matches (`matchType: "practice"`). */
  | "official"
  /** A practice-scouting session row (`isPracticeScouting` / `practiceMode` / `practiceSessionId`). */
  | "practice"
  /** A sub-in request or claim (`entryType` `sub-in-request` | `sub-in-claim` | `sub-in`). D7: lives elsewhere in the rebuild; readers skip it. */
  | "sub-in"
  /** A lead-scout row written through CS's permission fallback (`entryType: "lead"` / `isLeadScouting`). */
  | "lead"
  /** Anything else: a doc of a game no plugin knows. Never shown, never rewritten. */
  | "other";

/** CS `scoutingFlagStates/{entityType}:{entityId}` document (app/utils/scoutingFlags.ts `StoredFlagState` plus `teamId`). */
export type CsFlagState = {
  teamId?: string;
  entityType?: string;
  entityId?: string;
  dismissed?: boolean;
  dismissedAt?: number | null;
  dismissedBy?: string;
  manualFlagged?: boolean;
  manualFlaggedAt?: number | null;
  manualFlaggedBy?: string;
  manualReason?: string;
  excludeFromAccuracy?: boolean;
  excludeReason?: string;
  excludedAt?: number | null;
  excludedBy?: string;
  /** Additive CE field: the CE manual-flag reason label, so a CE reason without a CS equivalent survives a round trip. */
  ceManualReason?: string;
  /** Additive CE field: the CE manual-flag note. */
  ceManualNote?: string;
  [key: string]: unknown;
};

/** `teams/{TEAMCODE}.submissionControls` (CS app/utils/submissionControls.ts). */
export type CsSubmissionControls = {
  globalLockout?: boolean;
  lockoutReason?: string;
  updatedAt?: number | null;
  updatedBy?: string;
  [key: string]: unknown;
};

/** The lockout CS's `assertSubmissionsOpen` enforces on every new submission (edit mode bypasses it). */
export type SubmissionLockout = { locked: boolean; reason: string };

/** `users/{uid}` as CS stores it (app/AuthContext.tsx `UserData`, docs/AUDIT.md 3.2). Everything optional: old docs lack most of it. */
export type CsUserDoc = {
  uid?: string;
  email?: string;
  displayName?: string;
  role?: string;
  roles?: string[];
  secondaryRoles?: string[];
  specialRole?: string | null;
  specialRoles?: string[];
  teamId?: string;
  isTeamAdmin?: boolean;
  photoURL?: string;
  bio?: string;
  profileVisibility?: "team" | "public" | "private";
  profileComplete?: boolean;
  preferredDashboard?: string;
  canManageVersionReleases?: boolean;
  emailVerificationExempt?: boolean;
  accountThemeId?: string;
  accountFontId?: string;
  experiencedScout?: boolean;
  createdAt?: unknown;
  /** Write-only copy sent through CS's /api/user/encrypt. Never read, never written, never dropped by a merge write. */
  encryptedUserData?: string;
  userDataEncryptedAt?: unknown;
  [key: string]: unknown;
};

/** `teams/{TEAMCODE}` as CS stores it (docs/AUDIT.md 3.2). */
export type CsTeamDoc = {
  teamName?: string;
  teamNumber?: string | number;
  verifiedOwnerId?: string;
  selectedEvents?: string[];
  /** ADDITIVE (rebuild only, CS ignores it): `{ [eventKey]: name }` for the selected events, written with `selectedEvents` so the names survive an API outage. */
  selectedEventNames?: Record<string, string>;
  eventAttendees?: Record<string, string[]>;
  manualTeamListsByEvent?: Record<string, unknown>;
  formAccessOverrides?: Record<string, string[]>;
  submissionControls?: CsSubmissionControls;
  timeOverride?: { enabled?: boolean; offsetMs?: number; updatedAt?: number; updatedBy?: string };
  tbaApiKey?: string;
  tbaApiKeyEncrypted?: string;
  [key: string]: unknown;
};

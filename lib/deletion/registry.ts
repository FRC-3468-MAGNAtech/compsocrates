import { PROGRAMS } from "@/config/programs";
import { PROGRAM_IDS, type ProgramId } from "@/config/programs/types";

/**
 * THE PERSON DATA REGISTRY (memberships build 4): the single place that says where a person lives in the database and what account deletion does there.
 * The deletion job (`lib/server/account-deletion/`) is driven by it, and `registry.test.ts` fails when code names a collection that is not listed here, or writes
 * a person field that its entry does not list. NEW CODE THAT STORES A PERSON (a uid, a name, an email, a token, a photo) MUST UPDATE THIS FILE (or the program's
 * own list: `data/cs/deletion-entries.ts`, `lib/ftc/deletion-entries.ts`) IN THE SAME CHANGE.
 *
 * Actions: `delete` (the rows go), `rewrite` (the row stays, the person's uid becomes the job's opaque id and the name "Deleted Account"), `keep` (nothing about
 * the person; documented), `owner` (an owner decision: not processed, reported), `none` (no person data; a reason is given).
 * Paths are program-relative (built with `programPath`) unless `scope: "site"` (one root path for the whole site). Never a collection-group query.
 */
export type PersonAction = "delete" | "rewrite" | "keep" | "owner" | "none";

/** A uid field and the name that belongs to it (dotted paths allowed: `target.targetUid`). The name is rewritten only when its uid matched. */
export type UidPair = { uid: string; name?: string };

/** What to rewrite inside one document (pure: `lib/deletion/rewrite.ts`). Missing paths are ignored, so a rewrite is safe to repeat. */
export type RewriteSpec = {
  pairs?: readonly UidPair[];
  /** Paths to arrays of uid strings (the uid is replaced by the opaque id, without a duplicate). */
  uidArrays?: readonly string[];
  /** Paths to maps keyed by uid (the key is renamed). */
  mapKeys?: readonly string[];
  /** Paths to maps whose values are uid arrays (`eventAttendees`). */
  mapOfArrays?: readonly string[];
  /** Arrays of maps (`judgeBookCards`, `slots`): the nested spec is applied to every element, paths relative to the element. */
  embedded?: readonly { path: string; spec: Omit<RewriteSpec, "embedded" | "deleteFields" | "deleteWhen" | "keepNameForIdPrefix"> }[];
  /** Top-level fields removed from a row of this person (an email, an applicant name): when the pair at `deleteWhen` matched, or the row was found by a known email. */
  deleteFields?: readonly string[];
  deleteWhen?: string;
  /** A document whose id starts with one of these keeps its names (it holds other people's names; only its uid fields are rewritten). */
  keepNameForIdPrefix?: readonly string[];
};

/** How a person's rows are found. Admin SDK, equality only; a query by `field == value` needs no index. */
export type Finder =
  | { kind: "equals"; field: string }
  | { kind: "arrayContains"; field: string }
  /** `field == a value known about the person` (their email, lower-case email). Used for rows that hold an email and maybe no uid. */
  | { kind: "equalsKnown"; field: string; known: "email" | "emailLower" }
  /** `<collection>/<uid>`. */
  | { kind: "docId" }
  /** Document ids that start with `<prefix><uid>_` (a documentId() range). */
  | { kind: "idPrefix"; prefixes: readonly string[] }
  /** `<collection>/<uid>/<sub>/*` for each sub. */
  | { kind: "userTree"; subcollections: readonly string[] }
  /** `teams/<t>/<path>` for each known team; `{uid}` in a path is replaced. */
  | { kind: "perTeamDoc"; paths: readonly string[] }
  /** `teams/<t>/<sub>` where `field == uid`, for each known team. */
  | { kind: "perTeamEquals"; sub: string; field: string }
  /** `<parent>` documents of each known team (`teamField == t`), then `<parent>/<id>/<child>` where `field == uid`. */
  | { kind: "teamChildren"; teamField: string; child: string; field: string }
  /** The team document itself, for each known team (embedded fields are rewritten in place). */
  | { kind: "teamDocs" }
  /** The collection's documents of each known team (`teamField == t`), read and tested in memory. Small collections only. */
  | { kind: "teamScan"; teamField: string }
  /** Paths the job derived from the person's own sessions BEFORE they were rewritten (match keys, lobby ids). `child` is `<id>/<child>/<uid>`. */
  | { kind: "derived"; source: "liveMatchKeys" | "lobbyIds"; child?: string }
  /**
   * Rows that carry only a NAME: `teamField == t and nameField == <known name>`, only where every uid field is empty, and never where another member of the same
   * teams has that name (those are counted, not rewritten). `idPrefix` instead matches imported rows by id and ignores the uid fields (an import's uid is the importer's).
   */
  | { kind: "namesInTeams"; nameField: string; uidFields: readonly string[]; teamField: string; idPrefix?: string };

export type RegistryEntry = {
  /** Stable id (the job's per-pass "done" list uses it). */
  id: string;
  /** Collection path relative to the program root, or the site root for `scope: "site"`. `*` stands for a team id. */
  collection: string;
  scope?: "program" | "site";
  action: PersonAction;
  /** EVERY field that holds a person (uid, name, email, token, photo, ...). The guard test compares writers with this list. */
  fields: readonly string[];
  finders: readonly Finder[];
  rewrite?: RewriteSpec;
  /** Set when the generic engine does not handle the entry: `memberships` copies documents to a new id, `finish` is the job document (removed last). */
  customStep?: "memberships" | "finish";
  /** Rewrites a document id that contains the person's name (imported rows). Return null to keep the id. */
  renameId?: (id: string, name: string) => string | null;
  note: string;
};

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Entries both programs have, with the same shape (collection names are the same under each program's root)
// ---------------------------------------------------------------------------------------------------------------------------------------------

const SHARED_RATE_LIMIT_PREFIXES = [
  "achievements-read_",
  "achievements-write_",
  "avatar-upload_",
  "avatar-remove_",
  "avatar-member-remove_",
  "my-requests_",
  "cancel-request_",
  "teamlabel_",
  "join_",
  "membership-lookup_",
  "membership-join_",
  "membership-decide_",
  "membership-leave_",
  "membership-remove_",
  "membership-access_",
  "share-practice_",
  "team-switch_",
  "account-delete_",
] as const;
export { SHARED_RATE_LIMIT_PREFIXES };

const uidOnly = (...fields: string[]): RewriteSpec => ({ pairs: fields.map((uid) => ({ uid })) });

export const SHARED_ENTRIES: readonly RegistryEntry[] = [
  { id: "users", collection: "users", action: "delete", fields: ["email", "name", "displayName", "photoURL", "avatar", "avatarUrl", "avatarBlobPath", "avatarSource", "fcmTokens", "bio", "profileVisibility"], finders: [{ kind: "docId" }], note: "the account document: profile, email, push tokens and avatar fields" },
  { id: "profiles", collection: "profiles", action: "delete", fields: ["displayName", "bio", "pronouns", "avatar"], finders: [{ kind: "docId" }], note: "public/private profile" },
  {
    id: "memberships", collection: "memberships", action: "rewrite", fields: ["uid", "name", "verifiedBy"],
    finders: [{ kind: "equals", field: "uid" }, { kind: "equals", field: "verifiedBy" }],
    rewrite: { pairs: [{ uid: "uid", name: "name" }, { uid: "verifiedBy" }] }, customStep: "memberships",
    note: "ended as `deleted`, kept with role and dates; the document is COPIED to {teamId}_{opaque} because the id holds the uid",
  },
  { id: "notifications", collection: "notifications", action: "delete", fields: ["uid"], finders: [{ kind: "equals", field: "uid" }], note: "score-ready notifications addressed to the person" },
  { id: "personalPractice", collection: "personalPractice", action: "delete", fields: ["uid", "scoutName"], finders: [{ kind: "userTree", subcollections: ["sessions", "entries", "state"] }], note: "private practice (and the share-on-join marker)" },
  {
    id: "practiceSessions", collection: "practiceSessions", action: "rewrite", fields: ["uid", "scoutId", "scoutName"],
    finders: [{ kind: "equals", field: "uid" }, { kind: "equals", field: "scoutId" }, { kind: "namesInTeams", nameField: "scoutName", uidFields: ["uid", "scoutId"], teamField: "teamId" }],
    rewrite: { pairs: [{ uid: "uid", name: "scoutName" }, { uid: "scoutId", name: "scoutName" }] },
    note: "sessions kept for team numbers and accuracy, including copies made by share-on-join (their ids hold a truncated hash of the uid: not reversible, kept)",
  },
  {
    id: "formEntries", collection: "formEntries", action: "rewrite", fields: ["uid", "scoutName"],
    finders: [{ kind: "equals", field: "uid" }, { kind: "namesInTeams", nameField: "scoutName", uidFields: ["uid"], teamField: "teamId" }],
    rewrite: { pairs: [{ uid: "uid", name: "scoutName" }] }, note: "custom form entries",
  },
  {
    id: "auditLog", collection: "auditLog", action: "rewrite", fields: ["uid", "actorName", "target.targetUid", "target.targetName"],
    finders: [{ kind: "equals", field: "uid" }, { kind: "equals", field: "target.targetUid" }],
    rewrite: { pairs: [{ uid: "uid", name: "actorName" }, { uid: "target.targetUid", name: "target.targetName" }] },
    note: "the team's audit log keeps its rows; free-form before/after payloads are not scanned (see the results file)",
  },
  {
    id: "teamApplications", collection: "teamApplications", action: "rewrite", fields: ["applicantUid", "applicantName", "applicantEmail", "emailKey", "decidedBy"],
    finders: [{ kind: "equals", field: "applicantUid" }, { kind: "equals", field: "decidedBy" }, { kind: "equalsKnown", field: "applicantEmail", known: "email" }],
    rewrite: { pairs: [{ uid: "applicantUid" }, { uid: "decidedBy" }], deleteFields: ["applicantName", "applicantEmail", "emailKey"], deleteWhen: "applicantUid" },
    note: "status and team number stay; applicant name, email and the email-derived key go",
  },
  { id: "applicationPrivate", collection: "applicationPrivate", action: "rewrite", fields: ["notesUpdatedBy", "ipHash"], finders: [{ kind: "equals", field: "notesUpdatedBy" }], rewrite: uidOnly("notesUpdatedBy"), note: "hashed signals stay; no email or name is stored here" },
  {
    id: "applicationBlocks", collection: "applicationBlocks", action: "rewrite", fields: ["value", "createdBy"],
    finders: [{ kind: "equalsKnown", field: "value", known: "email" }, { kind: "equals", field: "createdBy" }],
    rewrite: { pairs: [{ uid: "createdBy" }], deleteFields: ["value"] },
    note: "the document id is an HMAC and stays (the block keeps working); the plain email in `value` goes",
  },
  {
    id: "platformAuditLog", collection: "platformAuditLog", action: "rewrite", fields: ["actorUid", "actorName", "details.applicantUid"],
    finders: [{ kind: "equals", field: "actorUid" }, { kind: "equals", field: "details.applicantUid" }],
    rewrite: { pairs: [{ uid: "actorUid", name: "actorName" }, { uid: "details.applicantUid" }] }, note: "the owner's own log",
  },
  { id: "rateLimits", collection: "rateLimits", scope: "site", action: "delete", fields: ["key"], finders: [{ kind: "idPrefix", prefixes: SHARED_RATE_LIMIT_PREFIXES }], note: "counters whose id embeds the uid (hashed ip/email counters hold no uid and expire)" },
  {
    id: "forms", collection: "forms", action: "rewrite", fields: ["createdBy", "updatedBy"],
    finders: [{ kind: "equals", field: "createdBy" }, { kind: "equals", field: "updatedBy" }], rewrite: uidOnly("createdBy", "updatedBy"), note: "the form stays with the team",
  },
  {
    id: "formVersions", collection: "forms/*/versions", action: "rewrite", fields: ["createdBy"],
    finders: [{ kind: "teamChildren", teamField: "teamId", child: "versions", field: "createdBy" }], rewrite: uidOnly("createdBy"), note: "found by reading each known team's forms, then their versions",
  },
  { id: "libraryMatches", collection: "libraryMatches", action: "rewrite", fields: ["createdBy"], finders: [{ kind: "equals", field: "createdBy" }], rewrite: uidOnly("createdBy"), note: "match library" },
  { id: "libraryEvents", collection: "libraryEvents", action: "rewrite", fields: ["createdBy"], finders: [{ kind: "equals", field: "createdBy" }], rewrite: uidOnly("createdBy"), note: "match library events" },
  {
    id: "pickLists", collection: "pickLists", action: "rewrite", fields: ["updatedBy", "updatedByName"],
    finders: [{ kind: "equals", field: "updatedBy" }], rewrite: { pairs: [{ uid: "updatedBy", name: "updatedByName" }] }, note: "pick list documents",
  },
  { id: "eventAttendance", collection: "eventAttendance", action: "rewrite", fields: ["uids"], finders: [{ kind: "arrayContains", field: "uids" }], rewrite: { uidArrays: ["uids"] }, note: "attendance is kept; the uid in the list becomes the opaque id (one atomic write per document)" },
  { id: "changelog", collection: "changelog", action: "rewrite", fields: ["createdBy"], finders: [{ kind: "equals", field: "createdBy" }], rewrite: uidOnly("createdBy"), note: "older per-team changelog documents (no longer written)" },
  { id: "credits", collection: "credits", action: "rewrite", fields: ["updatedBy", "updatedByName"], finders: [{ kind: "equals", field: "updatedBy" }], rewrite: { pairs: [{ uid: "updatedBy", name: "updatedByName" }] }, note: "older per-team credits documents (no longer written)" },
  { id: "liveMatchScouts", collection: "liveMatches/*/scouts", action: "delete", fields: ["uid", "name"], finders: [{ kind: "derived", source: "liveMatchKeys", child: "scouts" }], note: "live presence; match keys come from the person's own sessions and are saved in the job so the sweep can check the same paths" },
  { id: "lobbyPlayers", collection: "lobbies/*/players", action: "delete", fields: ["uid", "name"], finders: [{ kind: "derived", source: "lobbyIds", child: "players" }], note: "lobby presence; lobby ids come from the person's own sessions" },
  {
    id: "lobbies", collection: "lobbies", action: "rewrite", fields: ["hostUid", "hostName", "pairing[].playerUids", "pairing[].robotForUid"],
    finders: [{ kind: "equals", field: "hostUid" }, { kind: "derived", source: "lobbyIds" }],
    rewrite: { pairs: [{ uid: "hostUid", name: "hostName" }], embedded: [{ path: "pairing", spec: { uidArrays: ["playerUids"], mapKeys: ["robotForUid"] } }] },
    note: "a lobby keeps its results; the host and pairing uids are rewritten",
  },
  {
    id: "teams", collection: "teams", action: "rewrite",
    fields: ["ownerUid", "verifiedOwnerId", "pendingTransfer.fromUid", "pendingTransfer.fromName", "pendingTransfer.toUid", "pendingTransfer.toName", "pickList.updatedBy", "eventAttendees", "judgeBookCards[].createdByUid", "judgeBookCards[].createdByName", "judgeBookCards[].updatedByUid", "judgeBookCards[].updatedByName", "versionReleases[].authorUid", "versionReleases[].authorName"],
    finders: [{ kind: "teamDocs" }],
    rewrite: {
      pairs: [{ uid: "ownerUid" }, { uid: "verifiedOwnerId" }, { uid: "pickList.updatedBy" }, { uid: "pendingTransfer.fromUid", name: "pendingTransfer.fromName" }, { uid: "pendingTransfer.toUid", name: "pendingTransfer.toName" }],
      mapOfArrays: ["eventAttendees"],
      embedded: [
        { path: "judgeBookCards", spec: { pairs: [{ uid: "createdByUid", name: "createdByName" }, { uid: "updatedByUid", name: "updatedByName" }] } },
        { path: "versionReleases", spec: { pairs: [{ uid: "authorUid", name: "authorName" }] } },
      ],
    },
    note: "a team is never deleted: a team whose only member left is kept ownerless (ownerUid and verifiedOwnerId rewritten)",
  },
  { id: "teamSettings", collection: "teams/*/settings", action: "rewrite", fields: ["updatedBy"], finders: [{ kind: "perTeamDoc", paths: ["settings/pageAccess", "settings/sidebar"] }], rewrite: uidOnly("updatedBy"), note: "page access and sidebar settings documents" },
  { id: "pageAccessRequests", collection: "teams/*/pageAccessRequests", action: "delete", fields: ["uid", "name"], finders: [{ kind: "perTeamEquals", sub: "pageAccessRequests", field: "uid" }], note: "the person's own access requests" },
  { id: "pageAccessDecisions", collection: "teams/*/pageAccessRequests", action: "rewrite", fields: ["decidedBy"], finders: [{ kind: "perTeamEquals", sub: "pageAccessRequests", field: "decidedBy" }], rewrite: uidOnly("decidedBy"), note: "requests this person (an admin) decided" },
  { id: "formTemplateSubdocs", collection: "formTemplates/*/reports", action: "owner", fields: ["uid", "name"], finders: [], note: "template reports and imports (`reports/{teamId}`, `imports/{teamId}`, `updates/*`) hold the reporting admin's uid; one subcollection per template, not scanned (owner decision, see the results file)" },
  { id: "formTemplateImports", collection: "formTemplates/*/imports", action: "owner", fields: ["uid"], finders: [], note: "see formTemplateSubdocs" },
  { id: "formTemplateUpdates", collection: "formTemplates/*/updates", action: "owner", fields: ["uid"], finders: [], note: "see formTemplateSubdocs" },
  { id: "accountDeletions", collection: "accountDeletions", scope: "site", action: "delete", fields: ["opaqueId"], finders: [{ kind: "docId" }], customStep: "finish", note: "the job document itself: removed at the very end, so no mapping from the person to the opaque id survives" },
  { id: "platformChangelog", collection: "platformChangelog", scope: "site", action: "rewrite", fields: ["createdBy", "editedBy"], finders: [{ kind: "equals", field: "createdBy" }, { kind: "equals", field: "editedBy" }], rewrite: uidOnly("createdBy", "editedBy"), note: "platform changelog (owner only; a platform owner is never deleted by this build)" },
  { id: "platformCredits", collection: "platformCredits", scope: "site", action: "none", fields: [], finders: [], note: "no person fields in the document (the actor is in platformAuditLog)" },
  { id: "appSettings", collection: "appSettings", action: "none", fields: [], finders: [], note: "switches and times only" },
  { id: "practiceMatches", collection: "practiceMatches", action: "none", fields: [], finders: [], note: "official match schedule and scores" },
  { id: "formPresets", collection: "formPresets", action: "none", fields: [], finders: [], note: "team form presets (teamId, name, fields): no person" },
  { id: "formTemplates", collection: "formTemplates", action: "none", fields: [], finders: [], note: "see each program's own formTemplates entry for authors" },
];

/** Both programs' registries, built from `ProgramConfig.deletion` (data only). The shared entries come first. */
export function registryFor(program: ProgramId): readonly RegistryEntry[] {
  const own = PROGRAMS[program].deletion.entries;
  const overridden = new Set(own.map((e) => e.id));
  return [...SHARED_ENTRIES.filter((e) => !overridden.has(e.id)), ...own];
}

export const PERSON_DATA_REGISTRY: Readonly<Record<ProgramId, readonly RegistryEntry[]>> = Object.fromEntries(PROGRAM_IDS.map((p) => [p, registryFor(p)])) as Record<ProgramId, readonly RegistryEntry[]>;

/** The entries to run once for the whole site (`scope: "site"`), deduplicated across programs. */
export function siteEntries(): RegistryEntry[] {
  const seen = new Map<string, RegistryEntry>();
  for (const program of PROGRAM_IDS) for (const e of PERSON_DATA_REGISTRY[program]) if (e.scope === "site" && !seen.has(e.id)) seen.set(e.id, e);
  return [...seen.values()];
}

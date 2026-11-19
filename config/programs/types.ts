/**
 * The program layer: one site, two FIRST programs. Everything that differs between them is a field of `ProgramConfig`,
 * so a component asks `useProgram()` instead of naming a program. Pure data, safe to import from client code.
 */

import type { RegistryEntry } from "@/lib/deletion/registry";
import type { RadarProfile } from "@/config/games/radar";
import type { EventKeyShape } from "@/lib/events/event-key";

export const PROGRAM_IDS = ["frc", "ftc"] as const;
export type ProgramId = (typeof PROGRAM_IDS)[number];
export const DEFAULT_PROGRAM: ProgramId = "frc";

export function isProgramId(value: unknown): value is ProgramId {
  return typeof value === "string" && (PROGRAM_IDS as readonly string[]).includes(value);
}

export type ProgramBrand = {
  /** Short label for the selector and chips. */
  label: string;
  /** Full program name for copy. */
  fullName: string;
  tagline: string;
  description: string;
  /** Web app manifest and theme color. */
  themeColor: string;
};

export type ProgramEventRules = {
  allianceSize: number;
  /** "calendar": the season is the game's calendar year; "start-year": named for the year the season starts in. */
  seasonKind: "calendar" | "start-year";
  /** The season id a stored record with no `game` field counts as (old CS data). Absent: the program's default game. */
  unspecifiedGameId?: string;
  /** Does this program have EPA (Statbotics) data? */
  hasEpa: boolean;
  /**
   * Games that have events but no scouting config: `upcoming` ones (not announced yet) are a place in Analytics' Game list for the season's registered events and
   * show a notice where the stats would be; the rest (a past game that is not scouted) only appear in Event Select's game list.
   */
  otherGames?: { apiSeason: number; name: string; upcoming?: boolean }[];
  /** The shape of the event key in `/events/[eventKey]` (`lib/events/event-key.ts`): "tba" is `2026lake`, "season-code" is `2025-USCALAB`. */
  keyShape: EventKeyShape;
  /** What the event's key is called on screen. */
  codeLabel: string;
  /** Wording on the event page that names the program's data source. */
  eventCopy: {
    /** Why a key in the wrong shape is rejected (shown on the "Event not found" card). */
    invalidKeyReason: string;
    /** "... is a competition in the {seasonName} season". */
    seasonName: string;
    /** "Team lists are loaded from {teamListSource}." */
    teamListSource: string;
    /** The data-source credit: "Event and match data may include information from {before}{name} and ...". */
    credits: readonly { before: string; name: string; href: string }[];
  };
};

/**
 * The data features of the shared app a program has wired up. A shell piece or page control whose feature is off does not mount (or is
 * hidden) for that program, so it never reads the other program's collections. Turning one on means giving it a program-aware data layer first.
 */
export type ProgramFeatures = {
  /** Scout assignments (the schedule), the assignment watcher and the "next assignment" prompt. */
  assignments: boolean;
  /** Sub-in requests (a scout hands a match to a teammate). */
  subIns: boolean;
  /** Practice sessions and the "scores ready" watcher. */
  practice: boolean;
  /** Live match presence and live practice. Off: no live entry point, pill or watcher is shown and no live collection is read. */
  live: boolean;
  /** Practice lobbies (shared sessions). Off: no lobby entry point, join box or rejoin banner is shown and no lobby collection is read. Solo practice rides `practice`. */
  lobby: boolean;
  /** The match library and its admin backfill. */
  library: boolean;
  /** The shared pick list (the board and its edit log). */
  pickList: boolean;
  /** Accuracy and flag recompute after a save (reads official results and rewrites entries). */
  accuracy: boolean;
  /** Importing scouting entries from a CSV file. */
  csvImport: boolean;
  /** The changelog and its unread dot. */
  changelog: boolean;
  /** Team applications (the platform owner's pending count). */
  applications: boolean;
  /** Joining a team with its code: the join code on Team Management and the join-requests queue. */
  joinRequests: boolean;
  /** The team communication hub (announcements, strategy notes, match alerts). */
  announcements: boolean;
  /** Event names and dates are looked up from the program's events API (placeholders on the team doc). Off: the team doc holds complete event records. */
  eventLookup: boolean;
};

export type ProgramConnection = {
  /** App paths (no program segment) whose data layer is connected. "all" for a program whose pages all are. Any other path shows the gate inside the shell. */
  paths: readonly string[] | "all";
  features: ProgramFeatures;
};

/** The Admin Panel's tabs, by stable id (the page maps each id to its panel and label). */
export const ADMIN_TAB_IDS = [
  "match-library",
  "forms",
  "page-access",
  "sidebar",
  "achievements",
  "submissions",
  "entries",
  "sessions",
  "match-scout-ids",
  "practice-session-ids",
  "rescore",
  "audit-log",
  "backups",
  "applications",
  "templates",
  "recovery",
  "platform-changelog",
  "platform-credits",
  "verify-admins",
  "account-deletions",
  "read-usage",
  "setup-check",
] as const;
export type AdminTabId = (typeof ADMIN_TAB_IDS)[number];

/** The Admin Panel of a program: the ONE list of tabs it shows, in order (a tab not listed does not exist there), and whether it has the platform-owner settings card. */
export type ProgramAdmin = {
  tabs: readonly AdminTabId[];
  /** The platform owner's "Allow team creation" card (it reads root collections). */
  platformSettings: boolean;
  /** Public templates, "request to publish" and the owner's review (cross-team sharing). Off: the Forms tab shows the team's own templates only. */
  templateSharing: boolean;
};

export type ProgramConfig = {
  id: ProgramId;
  /** Session 8: the measures an achievement may use here (ids in lib/achievements/metrics.ts). Missing means all. */
  achievementMetrics?: "all" | readonly string[];
  brand: ProgramBrand;
  event: ProgramEventRules;
  /**
   * Firestore path prefix. `""` for FRC: its collections stay at the root, untouched. A namespaced prefix for the
   * other program: every program collection lives under it (see lib/firebase/paths.ts).
   */
  firestorePrefix: string;
  /** The program's collection names (relative to `firestorePrefix`) the read estimate counts before a heavy admin tool runs (lib/read-meter/estimate.ts). */
  readEstimate: { entries: string; sessions: string; library: string; auditLog: string; members: string };
  /** App paths (without the program segment) that exist only for another program and are shown greyed out here. */
  unavailablePaths: readonly string[];
  /**
   * Are the shared pages wired to this program's data? When false the signed-in shell shows the program gate instead of
   * the pages (they would otherwise read another program's collections).
   */
  pagesConnected: boolean;
  /** Which paths and data features of the shared app are connected (read when `pagesConnected`). */
  connection: ProgramConnection;
  /** The Admin Panel's tab list (see `lib/admin/tabs.ts`, the one resolver). */
  admin: ProgramAdmin;
  /** May one account hold several teams and switch between them (lib/our-team.ts)? Off: one team per account, and no switcher is shown. */
  multiTeam: boolean;
  /**
   * What Team Settings shows beyond the team's name and number (a multi-team program edits its teams list instead of the single name/number).
   * `ownershipTransfer`: the Ownership card (its actions call a server route that only knows the default program's teams).
   */
  teamSettings: { ownershipTransfer: boolean };
  /**
   * Practice Scouting copy and rules that differ by program (the screens themselves are shared).
   * `noScoreIsResult`: a finished session whose library match has no official score yet shows its result (no accuracy) instead of a loading skeleton.
   * `liveTileText`: the sentence under the "Live" tile (only shown where `connection.features.live` is on).
   */
  practice: { noScoreIsResult: boolean; liveTileText: string };
  /**
   * The practice difficulty cut-offs of the games this program has that the default program's registry does not know, by game id (upper case):
   * `lib/difficulty.ts` reads them for this program. Absent: the default program's own game table applies.
   */
  /**
   * Match Library rules that differ by program (the panel, its dialogs and its tables are shared).
   * `scoresRequired`: a hand-made match needs both scores (played matches); off, a blank score means "no official score yet" (scheduled matches).
   * `importKind`: what the events API gives, played matches with scores or a schedule; it only picks the words of the import copy.
   * `scheduledTime`: hand-made matches may carry a scheduled start time.
   * `editImportedScores`: an admin may enter the official score of an imported match (off: the API's scores stand).
   * `backfill`: the one-time "Update library" stamp for documents written before publishing existed.
   * `placeholderVideoSwitch`, `videoCsv`: tools that write the default program's team document or video map.
   */
  library: { scoresRequired: boolean; importKind: "played" | "schedule"; scheduledTime: boolean; editImportedScores: boolean; backfill: boolean; placeholderVideoSwitch: boolean; videoCsv: boolean };
  gameDifficulty?: Readonly<Record<string, { readonly easyMax: number; readonly mediumMax: number }>>;
  /**
   * The Robot Radar profile of each game that has one, by season id (`rebuilt`, `biobuzz`). The radar page uses the viewed game's profile, else the first one
   * listed (the program's radar game), and skips entries of other games.
   */
  radar: Readonly<Record<string, RadarProfile>>;
  /** How an account's membership in a team maps onto this program's user document (lib/server/memberships.ts). Data only. */
  membership: ProgramMembership;
  /** Account deletion: this program's own person-data entries (`lib/deletion/registry.ts`). Data only. */
  deletion: { readonly entries: readonly RegistryEntry[] };
};

/**
 * Memberships (docs/MEMBERSHIP_PLAN.md): the membership document uses ONE set of field names (`role`, `roles`, `secondaryRoles`, `isAdmin`, `isOwner`,
 * `fieldTeamIds`); `userFields` says which field of THIS program's user document each one is saved from and restored to (`null`: the program has no such
 * field). `isPlatformOwner` is never part of a membership.
 */
export type ProgramMembership = {
  /** The role a NEW membership gets from a future join flow (a role id of `lib/roles.ts`). Never applied to an existing user's stored role. */
  defaultJoinRole: string;
  userFields: {
    role: string;
    roles: string | null;
    secondaryRoles: string;
    isAdmin: string;
    isOwner: string;
    /** Absent or null: this program has no such field. */
    fieldTeamIds?: string | null;
  };
  /** The user-document fields the display-name snapshot is read from, first non-empty wins. */
  nameFields: readonly string[];
  /** Build 2 (join, leave, removal): how this program stores what the shared server flows touch. Data only. */
  flows: MembershipFlows;
};

/**
 * Where and how the shared membership flows (lib/server/membership-flows.ts) read and write this program's documents. Every name here is DATA: the flows
 * never ask which program they are serving.
 */
export type MembershipFlows = {
  /** Team-document fields that name the owner's uid, first non-empty wins. */
  ownerFields: readonly string[];
  /** The team-document field listing the units a new member is assigned to (copied onto a new member), or null when the program has none. */
  assignableListField: string | null;
  /** The team-document field that lists the robot teams (each `{ number, name }`) of a team that has several, or null. Only the label snapshot reads it (`teamSnapshotOfDoc`). */
  robotTeamsField: string | null;
  /** A raw role value the program's rules treat as an admin (legacy), or null. */
  legacyAdminRole: string | null;
  /** Extra user-document fields reset when a person's LAST team ends (besides the mapped role, admin, owner and field-team fields). */
  leaveExtras: Readonly<Record<string, string | number | boolean | null | readonly never[]>>;
  /** How a team is found from a typed code: by document id only, or by id and then by its `joinCode` field. */
  teamLookup: "id" | "idOrJoinCode";
  /** Build 3 (applications): the length of a new team's random join code (also its document id), and how the team document stores its number (the field, and string or number). */
  newTeam: { joinCodeLength: number; numberField: string; numberKind: "string" | "number" };
  /** The route a join request goes through while the memberships switch is OFF (body `{ joinCode, name }`). With the switch ON every program uses `/api/team/membership/request-join`. */
  legacyJoinPath: string;
  /** The user document a person with no profile gets when their first request here is approved. */
  newUser: { storeUid: boolean; emailField: string | null; extras: Readonly<Record<string, string | number | boolean>>; createOnRequest: boolean };
  /** Is the admin flag on a user document locked against the person's own writes by this program's rules? Only says so in the "Verify admins" evidence note; it proves nothing by itself. */
  adminFlagLocked: boolean;
  /** The join-request documents. `flat`: one collection, an auto id, the team in a field. `perTeam`: `teams/{teamId}/joinRequests/{uid}`. */
  requests: {
    layout: "flat" | "perTeam";
    collection: string;
    userId: string;
    name: string;
    email: string | null;
    teamId: string | null;
    /** The field that holds the role the person asked for. */
    role: string;
    /** A second field that mirrors the asked-for role (written with it), or null. */
    alsoRole: string | null;
    /** `ms`: epoch milliseconds. `timestamp`: a Firestore Timestamp. */
    timeKind: "ms" | "timestamp";
    /** Extra fields every approved request carries (the program's own outcome fields). The value "@now" stands for the decision time. */
    approvedExtras: Readonly<Record<string, string | number | boolean>>;
    /** The program's own "who decided and when" fields (written beside the shared `decidedBy` / `decidedAt`), or null. */
    outcomeFields: { by: string; at: string } | null;
  };
};

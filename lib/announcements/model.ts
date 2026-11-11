// The pure Team Communication model: CS's `teamAnnouncements` collection (CS app/components/TeamAnnouncements.tsx) with no Firebase
// and no React. One doc per post: `teamId`, `authorId`, `authorName`, `body`, `type`, `createdAt` (epoch milliseconds). Posts are
// never edited; a team admin deletes (firestore.rules).

export const ANNOUNCEMENT_COLLECTION = "teamAnnouncements";

export const ANNOUNCEMENT_TYPES = ["announcement", "strategy-note", "match-alert"] as const;
export type AnnouncementType = (typeof ANNOUNCEMENT_TYPES)[number];

/** CS's pill labels. */
export const ANNOUNCEMENT_TYPE_LABELS: Record<AnnouncementType, string> = {
  announcement: "Announcement",
  "strategy-note": "Strategy Note",
  "match-alert": "Match Alert",
};

/** CS colored the type pill gray, yellow and red: the `Badge` variants with those tones. */
export const ANNOUNCEMENT_TYPE_BADGE: Record<AnnouncementType, "outline" | "warning" | "danger"> = {
  announcement: "outline",
  "strategy-note": "warning",
  "match-alert": "danger",
};

/** CS had no cap; a post is a short message, and this keeps one doc far below Firestore's 1 MiB limit. */
export const MAX_ANNOUNCEMENT_LENGTH = 2000;
/** CS's fallback author name. */
export const DEFAULT_AUTHOR_NAME = "Team Member";

export type TeamAnnouncement = {
  id: string;
  teamId: string;
  authorId: string;
  authorName: string;
  body: string;
  type: AnnouncementType;
  /** Epoch milliseconds. */
  createdAt: number;
};

/** What a create writes (no id). */
export type NewTeamAnnouncement = Omit<TeamAnnouncement, "id">;

export type AnnouncementActor = { uid: string; name: string };

export const isAnnouncementType = (value: unknown): value is AnnouncementType => ANNOUNCEMENT_TYPES.some((t) => t === value);

const text = (v: unknown): string => (typeof v === "string" ? v : "");

/** A stored `createdAt` as epoch ms: a number (CS), or a Firestore Timestamp-like object (`toMillis`). Anything else is 0. */
function millis(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v && typeof v === "object" && "toMillis" in v && typeof (v as { toMillis: unknown }).toMillis === "function") {
    const ms = (v as { toMillis: () => unknown }).toMillis();
    return typeof ms === "number" && Number.isFinite(ms) ? ms : 0;
  }
  return 0;
}

/** A stored doc as `TeamAnnouncement`. Tolerant: an unknown or missing type reads as "announcement" (CS's fallback); unknown fields are ignored. */
export function parseAnnouncement(id: string, data: Record<string, unknown>): TeamAnnouncement {
  return {
    id,
    teamId: text(data.teamId),
    authorId: text(data.authorId),
    authorName: text(data.authorName),
    body: text(data.body),
    type: isAnnouncementType(data.type) ? data.type : "announcement",
    createdAt: millis(data.createdAt),
  };
}

/** Newest first. The query has no `orderBy` (that would need a composite index), so the client sorts; ties break on id so the order is stable. */
export function sortNewestFirst(posts: readonly TeamAnnouncement[]): TeamAnnouncement[] {
  return [...posts].sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export type BodyCheck = { ok: true; body: string } | { ok: false; reason: string };

/** CS trims the message and refuses an empty one ("Write a message before posting."). */
export function checkBody(raw: string): BodyCheck {
  const body = raw.trim();
  if (!body) return { ok: false, reason: "Write a message before posting." };
  if (body.length > MAX_ANNOUNCEMENT_LENGTH) return { ok: false, reason: `Keep it under ${MAX_ANNOUNCEMENT_LENGTH} characters.` };
  return { ok: true, body };
}

/** The doc a post writes: CS's fields exactly (the rules require `authorId` to be the poster). A blank display name is "Team Member". */
export function buildAnnouncement(input: { teamId: string; actor: AnnouncementActor; body: string; type: AnnouncementType; now: number }): NewTeamAnnouncement {
  return {
    teamId: input.teamId,
    authorId: input.actor.uid,
    authorName: input.actor.name.trim() || DEFAULT_AUTHOR_NAME,
    body: input.body,
    type: input.type,
    createdAt: input.now,
  };
}

/** The author line's label for the pill: an unknown type still reads "Announcement" (CS `TYPE_LABELS[post.type] || "Announcement"`). */
export const typeLabel = (type: AnnouncementType): string => ANNOUNCEMENT_TYPE_LABELS[type] ?? ANNOUNCEMENT_TYPE_LABELS.announcement;

/** Deleting is a team admin's right (firestore.rules `isTeamAdmin`; CS `userData.isTeamAdmin`). */
export const canDeleteAnnouncement = (isAdmin: boolean): boolean => isAdmin;

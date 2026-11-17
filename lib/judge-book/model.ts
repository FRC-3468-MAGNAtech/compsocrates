import { parseCsv } from "@/lib/analytics/csv";
import type { RoleId } from "@/lib/roles";

// The pure Judge Book model: CS's card shape and its rules (CS app/utils/judgeBook.ts and the two judge-book pages), with no
// Firebase and no React. Storage shape is CS's (D1): `teams/{id}.judgeBookCards[]` plus `judgeBookUpdatedAt`, with a legacy
// top-level `judgeBookCards` collection. Writes work on the **raw** array so a field or a row this code doesn't know is
// carried through untouched (D10).

export type JudgeBookSource = "team-doc" | "legacy-collection";

export type JudgeBookCard = {
  id: string;
  teamId: string;
  prompt: string;
  answer: string;
  /** "" when the card has no image. */
  imageUrl: string;
  /** Epoch milliseconds (CS stores plain numbers). */
  createdAt: number;
  updatedAt: number;
  createdByUid: string;
  createdByName: string;
  updatedByUid: string;
  updatedByName: string;
  source: JudgeBookSource;
};

/** What the create and edit forms hold. */
export type CardDraft = { prompt: string; answer: string; imageUrl: string };

export type Actor = { uid: string; name: string; teamId: string };

/** The fields an edit changes. Everything else on the stored row is left as it was. */
export type CardPatch = Pick<JudgeBookCard, "prompt" | "answer" | "imageUrl" | "updatedAt" | "updatedByUid" | "updatedByName">;

/** The key CS's `formAccessOverrides` uses to grant a member edit rights on the Judge Book. */
export const JUDGE_BOOK_EDIT_KEY = "judge-book-edit";

/** Roles that may edit without a grant. CS also treats a legacy `coach` role as `team-coach`; the profile already holds the canonical id. */
const EDITOR_ROLES: readonly RoleId[] = ["team-coach", "judge-awards"];

export const emptyDraft = (): CardDraft => ({ prompt: "", answer: "", imageUrl: "" });

export const cardToDraft = (card: Pick<JudgeBookCard, "prompt" | "answer" | "imageUrl">): CardDraft => ({
  prompt: card.prompt,
  answer: card.answer,
  imageUrl: card.imageUrl,
});

function positiveNumber(value: unknown): number {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * One stored row to a card, or null when it has no id or no prompt (CS hides those). `source` is stamped by the reader.
 * Missing times fall back to `now`, as CS does.
 */
export function normalizeJudgeBookCard(value: unknown, source: JudgeBookSource = "team-doc", now: number = Date.now()): JudgeBookCard | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = String(row.id || "").trim();
  const prompt = String(row.prompt || "").trim();
  if (!id || !prompt) return null;
  const createdAt = positiveNumber(row.createdAt);
  const updatedAt = positiveNumber(row.updatedAt) || createdAt;
  return {
    id,
    teamId: String(row.teamId || "").trim(),
    prompt,
    answer: String(row.answer || ""),
    imageUrl: String(row.imageUrl || ""),
    createdAt: createdAt || now,
    updatedAt: updatedAt || now,
    createdByUid: String(row.createdByUid || ""),
    createdByName: String(row.createdByName || ""),
    updatedByUid: String(row.updatedByUid || ""),
    updatedByName: String(row.updatedByName || ""),
    source,
  };
}

/** Newest first, by last edit. */
export function sortJudgeBookCards(cards: readonly JudgeBookCard[]): JudgeBookCard[] {
  return [...cards].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

/** The visible cards of a team doc's `judgeBookCards` array (anything that isn't a valid card is skipped), newest first. */
export function cardsFromTeamDoc(raw: unknown, teamId: string, now: number = Date.now()): JudgeBookCard[] {
  const rows = Array.isArray(raw) ? raw : [];
  const cards: JudgeBookCard[] = [];
  for (const row of rows) {
    const card = normalizeJudgeBookCard(row, "team-doc", now);
    if (card) cards.push({ ...card, teamId });
  }
  return sortJudgeBookCards(cards);
}

/** A legacy `judgeBookCards` collection doc to a card. The doc id wins over any `id` field, as in CS. */
export function cardFromLegacyDoc(id: string, data: unknown, now: number = Date.now()): JudgeBookCard | null {
  if (!data || typeof data !== "object") return null;
  return normalizeJudgeBookCard({ ...(data as Record<string, unknown>), id }, "legacy-collection", now);
}

/** The uids granted edit rights through `teams/{id}.formAccessOverrides["judge-book-edit"]` (trimmed, de-duplicated, blanks dropped). */
export function judgeBookEditGrants(formAccessOverrides: unknown): string[] {
  if (!formAccessOverrides || typeof formAccessOverrides !== "object") return [];
  const list = (formAccessOverrides as Record<string, unknown>)[JUDGE_BOOK_EDIT_KEY];
  if (!Array.isArray(list)) return [];
  return list.map((id) => String(id || "").trim()).filter((id, index, all) => id.length > 0 && all.indexOf(id) === index);
}

export type JudgeBookEditor = { uid?: string | null; isAdmin?: boolean; primaryRole?: RoleId; secondaryRoles?: readonly RoleId[] };

/**
 * CS `canEditJudgeBook`: a team admin, a Team Coach or Judge Awards (primary or secondary), or a member the team granted
 * `judge-book-edit`. Everyone else reads. (D6: CS's `isTeamAdmin` is the app's `isAdmin`.)
 */
export function canEditJudgeBook(user: JudgeBookEditor | null | undefined, grants: readonly string[] = []): boolean {
  if (!user) return false;
  if (user.isAdmin) return true;
  const roles = [user.primaryRole, ...(user.secondaryRoles ?? [])];
  if (roles.some((role) => role && EDITOR_ROLES.includes(role))) return true;
  return Boolean(user.uid && grants.includes(user.uid));
}

/** Case-insensitive match on the question or the answer. A blank query keeps everything. */
export function searchCards(cards: readonly JudgeBookCard[], query: string): JudgeBookCard[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...cards];
  return cards.filter((card) => card.prompt.toLowerCase().includes(q) || card.answer.toLowerCase().includes(q));
}

/** `http` and `https` image links only; anything else (a `javascript:` or `data:` URL, plain text) is not shown. */
export function safeImageUrl(url: string | null | undefined): string | null {
  const trimmed = String(url ?? "").trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/** A new card id in CS's format: `jb-<epoch ms>-<6 random chars>`. */
export function newJudgeBookId(now: number = Date.now(), random: () => number = Math.random): string {
  return `jb-${now}-${random().toString(36).slice(2, 8)}`;
}

/** Trims each draft and drops the ones without a question/title. */
export function cleanDrafts(rows: readonly CardDraft[]): CardDraft[] {
  return rows
    .map((row) => ({ prompt: row.prompt.trim(), answer: row.answer.trim(), imageUrl: row.imageUrl.trim() }))
    .filter((row) => row.prompt.length > 0);
}

/** The multi-card box: one card per line, `question | answer | optional-image-url`. */
export function parseMultiDraft(text: string): CardDraft[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("|").map((part) => part.trim());
      return { prompt: parts[0] || "", answer: parts[1] || "", imageUrl: parts[2] || "" };
    });
}

const normalizeHeader = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, "");
const PROMPT_HEADERS = ["question", "prompt", "title", "label"];
const ANSWER_HEADERS = ["answer", "response", "value", "details"];
const IMAGE_HEADERS = ["image", "imageurl", "img", "photo", "chart"];

/**
 * A CSV file to drafts, as CS reads it: a header row is recognised by any of the question, answer or image header names
 * (case and punctuation ignored); without one the columns are question, answer, image in that order.
 */
export function parseCsvDrafts(text: string): CardDraft[] {
  const records = parseCsv(text);
  if (records.length === 0) return [];
  const headers = records[0].map(normalizeHeader);
  const promptIndex = headers.findIndex((h) => PROMPT_HEADERS.includes(h));
  const answerIndex = headers.findIndex((h) => ANSWER_HEADERS.includes(h));
  const imageIndex = headers.findIndex((h) => IMAGE_HEADERS.includes(h));
  const hasHeader = promptIndex >= 0 || answerIndex >= 0 || imageIndex >= 0;
  const cell = (cells: string[], index: number, fallback: number) => String(cells[hasHeader && index >= 0 ? index : fallback] || "").trim();
  return (hasHeader ? records.slice(1) : records).map((cells) => ({
    prompt: cell(cells, promptIndex, 0),
    answer: cell(cells, answerIndex, 1),
    imageUrl: cell(cells, imageIndex, 2),
  }));
}

/** New cards from drafts (blank questions dropped). All share one timestamp, as in CS. */
export function buildNewCards(drafts: readonly CardDraft[], actor: Actor, now: number = Date.now(), makeId: () => string = () => newJudgeBookId(now)): JudgeBookCard[] {
  const name = actor.name || "Unknown";
  return cleanDrafts(drafts).map((draft) => ({
    id: makeId(),
    teamId: actor.teamId,
    prompt: draft.prompt,
    answer: draft.answer,
    imageUrl: draft.imageUrl,
    createdAt: now,
    updatedAt: now,
    createdByUid: actor.uid,
    createdByName: name,
    updatedByUid: actor.uid,
    updatedByName: name,
    source: "team-doc" as const,
  }));
}

/** The edit patch for a draft, or null when the question/title is empty (CS refuses to save that). */
export function buildCardPatch(draft: CardDraft, actor: Pick<Actor, "uid" | "name">, now: number = Date.now()): CardPatch | null {
  const prompt = draft.prompt.trim();
  if (!prompt) return null;
  return {
    prompt,
    answer: draft.answer.trim(),
    imageUrl: draft.imageUrl.trim(),
    updatedAt: now,
    updatedByUid: actor.uid,
    updatedByName: actor.name || "Unknown",
  };
}

/** The row CS writes into `judgeBookCards[]`: the card without its `source`. */
export function toCardPayload(card: JudgeBookCard): Record<string, unknown> {
  return {
    id: card.id,
    teamId: card.teamId,
    prompt: card.prompt,
    answer: card.answer,
    imageUrl: card.imageUrl || "",
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
    createdByUid: card.createdByUid || "",
    createdByName: card.createdByName || "",
    updatedByUid: card.updatedByUid || "",
    updatedByName: card.updatedByName || "",
  };
}

// --- Writes on the raw team-doc array ---------------------------------------------------------------------------------
// Each returns a new array. Rows that aren't cards this code can read, and fields it doesn't know, stay exactly as stored.

const rowId = (row: unknown): string => (row && typeof row === "object" ? String((row as Record<string, unknown>).id || "").trim() : "");

/** New cards go first (CS sorts newest first). */
export function addCardsToRaw(raw: unknown, cards: readonly JudgeBookCard[]): unknown[] {
  return [...cards.map(toCardPayload), ...(Array.isArray(raw) ? raw : [])];
}

/** Merges the patch into the stored row with that id. `found` is false when no row has it (someone deleted it meanwhile). */
export function updateCardInRaw(raw: unknown, id: string, patch: CardPatch): { rows: unknown[]; found: boolean } {
  const rows = Array.isArray(raw) ? raw : [];
  let found = false;
  const next = rows.map((row) => {
    if (rowId(row) !== id) return row;
    found = true;
    return { ...(row as Record<string, unknown>), ...patch };
  });
  return { rows: next, found };
}

export function removeCardFromRaw(raw: unknown, id: string): unknown[] {
  return (Array.isArray(raw) ? raw : []).filter((row) => rowId(row) !== id);
}

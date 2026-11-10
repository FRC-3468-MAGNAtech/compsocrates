import { describe, expect, it } from "vitest";
import {
  addCardsToRaw,
  buildCardPatch,
  buildNewCards,
  canEditJudgeBook,
  cardFromLegacyDoc,
  cardsFromTeamDoc,
  cleanDrafts,
  judgeBookEditGrants,
  newJudgeBookId,
  normalizeJudgeBookCard,
  parseCsvDrafts,
  parseMultiDraft,
  removeCardFromRaw,
  safeImageUrl,
  searchCards,
  sortJudgeBookCards,
  toCardPayload,
  updateCardInRaw,
} from "@/lib/judge-book/model";

const NOW = 1_700_000_000_000;
const actor = { uid: "u1", name: "Ada", teamId: "T1" };

describe("normalizeJudgeBookCard", () => {
  it("reads a stored row and trims id and prompt", () => {
    const card = normalizeJudgeBookCard({ id: " jb-1 ", prompt: " Members ", answer: "34", createdAt: 5, updatedAt: 9, teamId: "T1" }, "team-doc", NOW);
    expect(card).toMatchObject({ id: "jb-1", prompt: "Members", answer: "34", imageUrl: "", createdAt: 5, updatedAt: 9, teamId: "T1", source: "team-doc" });
  });
  it("hides rows without an id or a prompt, and non-objects", () => {
    expect(normalizeJudgeBookCard({ prompt: "x" })).toBeNull();
    expect(normalizeJudgeBookCard({ id: "a", prompt: "  " })).toBeNull();
    expect(normalizeJudgeBookCard("nope")).toBeNull();
    expect(normalizeJudgeBookCard(null)).toBeNull();
  });
  it("falls back: updatedAt to createdAt, both to now", () => {
    expect(normalizeJudgeBookCard({ id: "a", prompt: "p", createdAt: 7 }, "team-doc", NOW)).toMatchObject({ createdAt: 7, updatedAt: 7 });
    expect(normalizeJudgeBookCard({ id: "a", prompt: "p" }, "team-doc", NOW)).toMatchObject({ createdAt: NOW, updatedAt: NOW });
    expect(normalizeJudgeBookCard({ id: "a", prompt: "p", createdAt: "bad", updatedAt: -3 }, "team-doc", NOW)).toMatchObject({ createdAt: NOW, updatedAt: NOW });
  });
});

describe("reading", () => {
  it("cardsFromTeamDoc skips invalid rows, stamps the team and sorts newest first", () => {
    const cards = cardsFromTeamDoc(
      [{ id: "a", prompt: "A", updatedAt: 1 }, { id: "", prompt: "bad" }, { id: "b", prompt: "B", updatedAt: 3 }, 42, { id: "c", prompt: "C", updatedAt: 2, teamId: "other" }],
      "T1",
      NOW
    );
    expect(cards.map((c) => c.id)).toEqual(["b", "c", "a"]);
    expect(cards.every((c) => c.teamId === "T1" && c.source === "team-doc")).toBe(true);
  });
  it("cardsFromTeamDoc tolerates a missing or non-array field", () => {
    expect(cardsFromTeamDoc(undefined, "T1")).toEqual([]);
    expect(cardsFromTeamDoc({ a: 1 }, "T1")).toEqual([]);
  });
  it("cardFromLegacyDoc uses the doc id and marks the source", () => {
    expect(cardFromLegacyDoc("doc9", { id: "ignored", prompt: "Q", teamId: "T1" }, NOW)).toMatchObject({ id: "doc9", source: "legacy-collection", teamId: "T1" });
    expect(cardFromLegacyDoc("doc9", { answer: "no prompt" }, NOW)).toBeNull();
    expect(cardFromLegacyDoc("doc9", null, NOW)).toBeNull();
  });
  it("sortJudgeBookCards does not mutate its input", () => {
    const a = normalizeJudgeBookCard({ id: "a", prompt: "A", updatedAt: 1 })!;
    const b = normalizeJudgeBookCard({ id: "b", prompt: "B", updatedAt: 2 })!;
    const input = [a, b];
    expect(sortJudgeBookCards(input).map((c) => c.id)).toEqual(["b", "a"]);
    expect(input.map((c) => c.id)).toEqual(["a", "b"]);
  });
});

describe("edit rights", () => {
  it("admins, team coaches and judge awards (primary or secondary) edit", () => {
    expect(canEditJudgeBook({ uid: "x", isAdmin: true })).toBe(true);
    expect(canEditJudgeBook({ uid: "x", primaryRole: "team-coach" })).toBe(true);
    expect(canEditJudgeBook({ uid: "x", primaryRole: "match-scout", secondaryRoles: ["judge-awards"] })).toBe(true);
  });
  it("others read, unless granted judge-book-edit", () => {
    expect(canEditJudgeBook({ uid: "x", primaryRole: "match-scout", secondaryRoles: ["media"] })).toBe(false);
    expect(canEditJudgeBook({ uid: "x", primaryRole: "match-scout" }, ["x"])).toBe(true);
    expect(canEditJudgeBook({ uid: "x", primaryRole: "match-scout" }, ["y"])).toBe(false);
    expect(canEditJudgeBook({ primaryRole: "match-scout" }, [""])).toBe(false);
    expect(canEditJudgeBook(null)).toBe(false);
    expect(canEditJudgeBook(undefined)).toBe(false);
  });
  it("judgeBookEditGrants reads the uid list, cleaned", () => {
    expect(judgeBookEditGrants({ "judge-book-edit": [" a ", "a", "", 7, null, "b"] })).toEqual(["a", "7", "b"]);
    expect(judgeBookEditGrants({ other: ["a"] })).toEqual([]);
    expect(judgeBookEditGrants({ "judge-book-edit": "a" })).toEqual([]);
    expect(judgeBookEditGrants(null)).toEqual([]);
  });
});

describe("search and image urls", () => {
  const cards = [
    normalizeJudgeBookCard({ id: "a", prompt: "Team size", answer: "34 students" })!,
    normalizeJudgeBookCard({ id: "b", prompt: "Build season", answer: "8 weeks" })!,
  ];
  it("matches the question or the answer, ignoring case", () => {
    expect(searchCards(cards, "STUDENTS").map((c) => c.id)).toEqual(["a"]);
    expect(searchCards(cards, "build").map((c) => c.id)).toEqual(["b"]);
    expect(searchCards(cards, "zzz")).toEqual([]);
  });
  it("a blank query keeps all", () => {
    expect(searchCards(cards, "   ")).toHaveLength(2);
  });
  it("safeImageUrl allows http(s) only", () => {
    expect(safeImageUrl(" https://example.com/a.png ")).toBe("https://example.com/a.png");
    expect(safeImageUrl("http://example.com/a.png")).toBe("http://example.com/a.png");
    expect(safeImageUrl("javascript:alert(1)")).toBeNull();
    expect(safeImageUrl("data:image/png;base64,AAAA")).toBeNull();
    expect(safeImageUrl("not a url")).toBeNull();
    expect(safeImageUrl("")).toBeNull();
    expect(safeImageUrl(undefined)).toBeNull();
  });
});

describe("drafts", () => {
  it("cleanDrafts trims and drops blank questions", () => {
    expect(cleanDrafts([{ prompt: " a ", answer: " b ", imageUrl: " c " }, { prompt: "  ", answer: "x", imageUrl: "" }])).toEqual([{ prompt: "a", answer: "b", imageUrl: "c" }]);
  });
  it("parseMultiDraft reads question | answer | image per line", () => {
    expect(parseMultiDraft("Member count | 34 students | https://x/y.png\r\n\nBuild season length | 8 weeks\nJust a question")).toEqual([
      { prompt: "Member count", answer: "34 students", imageUrl: "https://x/y.png" },
      { prompt: "Build season length", answer: "8 weeks", imageUrl: "" },
      { prompt: "Just a question", answer: "", imageUrl: "" },
    ]);
  });
  it("parseCsvDrafts maps a header row by name, in any column order", () => {
    const csv = "Answer,Question,Image URL\n34 students,Member count,https://x/y.png\n8 weeks,Build season,\n";
    expect(parseCsvDrafts(csv)).toEqual([
      { prompt: "Member count", answer: "34 students", imageUrl: "https://x/y.png" },
      { prompt: "Build season", answer: "8 weeks", imageUrl: "" },
    ]);
  });
  it("parseCsvDrafts without a header uses question, answer, image order, and keeps quoted commas", () => {
    expect(parseCsvDrafts('"Hello, world",answer one\nsecond,,https://x/z.png')).toEqual([
      { prompt: "Hello, world", answer: "answer one", imageUrl: "" },
      { prompt: "second", answer: "", imageUrl: "https://x/z.png" },
    ]);
  });
  it("parseCsvDrafts with only an answer column header leaves the prompt at column 0", () => {
    expect(parseCsvDrafts("a,details\nQ1,A1")).toEqual([{ prompt: "Q1", answer: "A1", imageUrl: "" }]);
    expect(parseCsvDrafts("")).toEqual([]);
  });
});

describe("building cards", () => {
  it("newJudgeBookId has CS's format", () => {
    expect(newJudgeBookId(NOW, () => 0.5)).toMatch(/^jb-1700000000000-[a-z0-9]{1,6}$/);
  });
  it("buildNewCards stamps the actor, one timestamp, and drops blank questions", () => {
    let n = 0;
    const cards = buildNewCards([{ prompt: " Q ", answer: "A", imageUrl: "" }, { prompt: "", answer: "x", imageUrl: "" }], actor, NOW, () => `id${++n}`);
    expect(cards).toEqual([
      {
        id: "id1",
        teamId: "T1",
        prompt: "Q",
        answer: "A",
        imageUrl: "",
        createdAt: NOW,
        updatedAt: NOW,
        createdByUid: "u1",
        createdByName: "Ada",
        updatedByUid: "u1",
        updatedByName: "Ada",
        source: "team-doc",
      },
    ]);
  });
  it("uses Unknown when the actor has no name", () => {
    expect(buildNewCards([{ prompt: "Q", answer: "", imageUrl: "" }], { ...actor, name: "" }, NOW)[0].createdByName).toBe("Unknown");
  });
  it("buildCardPatch refuses an empty question and trims the rest", () => {
    expect(buildCardPatch({ prompt: " ", answer: "a", imageUrl: "" }, actor, NOW)).toBeNull();
    expect(buildCardPatch({ prompt: " Q ", answer: " A ", imageUrl: " u " }, actor, NOW)).toEqual({
      prompt: "Q",
      answer: "A",
      imageUrl: "u",
      updatedAt: NOW,
      updatedByUid: "u1",
      updatedByName: "Ada",
    });
  });
  it("toCardPayload drops source and blanks missing optionals", () => {
    const card = normalizeJudgeBookCard({ id: "a", prompt: "P", createdAt: 1 }, "legacy-collection", NOW)!;
    const payload = toCardPayload(card);
    expect(payload).not.toHaveProperty("source");
    expect(payload).toMatchObject({ id: "a", prompt: "P", imageUrl: "", createdByUid: "", updatedByName: "" });
  });
});

describe("writes on the raw team-doc array keep what they don't know (D10)", () => {
  const raw = [
    { id: "a", prompt: "A", answer: "1", updatedAt: 1, createdAt: 1, pinned: true },
    { id: "", prompt: "unreadable row" },
    "stray string",
    { id: "b", prompt: "B", updatedAt: 2, createdAt: 2, extraField: { nested: 1 } },
  ];

  it("adds new cards first and leaves every old row alone", () => {
    const card = buildNewCards([{ prompt: "New", answer: "", imageUrl: "" }], actor, NOW, () => "n1")[0];
    const next = addCardsToRaw(raw, [card]);
    expect(next).toHaveLength(5);
    expect((next[0] as { id: string }).id).toBe("n1");
    expect(next.slice(1)).toEqual(raw);
  });
  it("add on a missing array starts one", () => {
    const card = buildNewCards([{ prompt: "New", answer: "", imageUrl: "" }], actor, NOW, () => "n1")[0];
    expect(addCardsToRaw(undefined, [card])).toHaveLength(1);
  });
  it("update merges only the edited fields into the matching row", () => {
    const patch = buildCardPatch({ prompt: "A2", answer: "2", imageUrl: "" }, actor, NOW)!;
    const { rows, found } = updateCardInRaw(raw, "a", patch);
    expect(found).toBe(true);
    expect(rows[0]).toEqual({ id: "a", prompt: "A2", answer: "2", imageUrl: "", updatedAt: NOW, createdAt: 1, pinned: true, updatedByUid: "u1", updatedByName: "Ada" });
    expect(rows.slice(1)).toEqual(raw.slice(1));
  });
  it("update reports a row that is gone", () => {
    const patch = buildCardPatch({ prompt: "X", answer: "", imageUrl: "" }, actor, NOW)!;
    const result = updateCardInRaw(raw, "zzz", patch);
    expect(result.found).toBe(false);
    expect(result.rows).toEqual(raw);
  });
  it("remove drops only the matching row", () => {
    expect(removeCardFromRaw(raw, "a")).toEqual(raw.slice(1));
    expect(removeCardFromRaw(raw, "nope")).toEqual(raw);
    expect(removeCardFromRaw(undefined, "a")).toEqual([]);
  });
});

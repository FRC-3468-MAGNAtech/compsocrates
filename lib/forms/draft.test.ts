import { describe, expect, it } from "vitest";
import { storageKey } from "@/config/brand";
import { REBUILT_FORM } from "@/lib/forms/builtin-rebuilt";
import { clearDraft, DRAFT_TTL_MS, draftAge, draftKey, hasProgress, lastDraftKey, loadDraft, loadLastDraft, matchKeyOf, parseDraft, saveDraft, type DraftStorage } from "@/lib/forms/draft";
import { defaultValues } from "@/lib/forms/values";
import type { FormValues } from "@/lib/forms/types";

const memory = (): DraftStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
};

const NOW = 1_700_000_000_000;
const progress = (): FormValues => ({ ...defaultValues(REBUILT_FORM), auto_cycleTimes: [3.2, 4.1], auto_wonAuto: true, notes: "fast" });
const match = { type: "Qualification", match: { matchNumber: 12 } };
const who = { uid: "u1", formId: "rebuilt" };

describe("hasProgress", () => {
  it("is false for a fresh form and true once any value differs", () => {
    expect(hasProgress(REBUILT_FORM, defaultValues(REBUILT_FORM))).toBe(false);
    expect(hasProgress(REBUILT_FORM, { ...defaultValues(REBUILT_FORM), notes: "x" })).toBe(true);
    expect(hasProgress(REBUILT_FORM, { ...defaultValues(REBUILT_FORM), auto_cycleTimes: [1] })).toBe(true);
    expect(hasProgress(REBUILT_FORM, { ...defaultValues(REBUILT_FORM), auto_cycleTimes: [] })).toBe(false);
    expect(hasProgress(REBUILT_FORM, {})).toBe(false); // missing keys read as the defaults
  });
});

describe("keys", () => {
  it("is per user, form, match and team, with `-` for what isn't picked yet", () => {
    expect(draftKey({ ...who, matchKey: "Qualification-12", teamNumber: 254 })).toBe(`${storageKey("scout-draft")}:v1:u1:rebuilt:Qualification-12:254`);
    expect(draftKey(who)).toBe(`${storageKey("scout-draft")}:v1:u1:rebuilt:-:-`);
    expect(draftKey({ ...who, matchKey: "Qualification-12", teamNumber: 254 })).not.toBe(draftKey({ ...who, matchKey: "Qualification-12", teamNumber: 255 }));
    expect(draftKey({ ...who, uid: "u2" })).not.toBe(draftKey(who));
    expect(lastDraftKey("u1", "rebuilt")).toBe(`${storageKey("scout-draft")}:v1:u1:rebuilt:last`);
    expect(matchKeyOf(match)).toBe("Qualification-12");
    expect(matchKeyOf(null)).toBeNull();
  });
});

describe("saving and loading", () => {
  it("round-trips a draft for the same match and team, and not for another", () => {
    const s = memory();
    expect(saveDraft(s, who, { match, teamNumber: 254, values: progress() }, "Qualification-12", NOW)).toBe(true);
    const d = loadDraft<typeof match>(s, { ...who, matchKey: "Qualification-12", teamNumber: 254 }, NOW + 1000);
    expect(d).toMatchObject({ v: 1, savedAt: NOW, formId: "rebuilt", teamNumber: 254, match });
    expect(d?.values.auto_cycleTimes).toEqual([3.2, 4.1]);
    expect(loadDraft(s, { ...who, matchKey: "Qualification-12", teamNumber: 255 }, NOW)).toBeNull();
    expect(loadDraft(s, { ...who, uid: "other", matchKey: "Qualification-12", teamNumber: 254 }, NOW)).toBeNull();
  });

  it("keeps a draft made before a match or team was picked, under its own key", () => {
    const s = memory();
    saveDraft(s, who, { match: null, teamNumber: null, values: progress() }, null, NOW);
    expect(loadDraft(s, who, NOW)?.values.notes).toBe("fast");
    expect(loadDraft(s, { ...who, matchKey: "Qualification-12", teamNumber: 254 }, NOW)).toBeNull();
  });

  it("the latest-draft pointer follows the last save, whatever its match and team", () => {
    const s = memory();
    saveDraft(s, who, { match, teamNumber: 254, values: progress() }, "Qualification-12", NOW);
    saveDraft(s, who, { match: { type: "Qualification", match: { matchNumber: 13 } }, teamNumber: 1678, values: { ...progress(), notes: "second" } }, "Qualification-13", NOW + 5);
    expect(loadLastDraft(s, "u1", "rebuilt", NOW + 10)).toMatchObject({ teamNumber: 1678, values: { notes: "second" } });
    expect(loadLastDraft(s, "u2", "rebuilt", NOW)).toBeNull();
    expect(loadLastDraft(s, "u1", "reefscape", NOW)).toBeNull();
  });

  it("ignores and removes an expired draft", () => {
    const s = memory();
    saveDraft(s, who, { match, teamNumber: 254, values: progress() }, "Qualification-12", NOW);
    const id = { ...who, matchKey: "Qualification-12", teamNumber: 254 };
    expect(loadDraft(s, id, NOW + DRAFT_TTL_MS - 1)).not.toBeNull();
    expect(loadDraft(s, id, NOW + DRAFT_TTL_MS + 1)).toBeNull();
    expect(s.data.has(draftKey(id))).toBe(false);
  });

  it("ignores damaged, foreign and wrong-version data", () => {
    expect(parseDraft("{not json", "rebuilt", NOW)).toBeNull();
    expect(parseDraft(null, "rebuilt", NOW)).toBeNull();
    expect(parseDraft(JSON.stringify({ v: 2, savedAt: NOW, formId: "rebuilt", values: {} }), "rebuilt", NOW)).toBeNull();
    expect(parseDraft(JSON.stringify({ v: 1, savedAt: NOW, formId: "reefscape", values: {} }), "rebuilt", NOW)).toBeNull();
    expect(parseDraft(JSON.stringify({ v: 1, savedAt: NOW, formId: "rebuilt", values: [] }), "rebuilt", NOW)).toBeNull();
    expect(parseDraft(JSON.stringify({ v: 1, savedAt: "x", formId: "rebuilt", values: {} }), "rebuilt", NOW)).toBeNull();
    expect(parseDraft(JSON.stringify({ v: 1, savedAt: NOW, formId: "rebuilt", values: {}, teamNumber: -4 }), "rebuilt", NOW)?.teamNumber).toBeNull();
  });

  it("a pointer to another user's draft is refused", () => {
    const s = memory();
    saveDraft(s, { uid: "u2", formId: "rebuilt" }, { match, teamNumber: 254, values: progress() }, "Qualification-12", NOW);
    s.setItem(lastDraftKey("u1", "rebuilt"), draftKey({ uid: "u2", formId: "rebuilt", matchKey: "Qualification-12", teamNumber: 254 }));
    expect(loadLastDraft(s, "u1", "rebuilt", NOW)).toBeNull();
  });
});

describe("clearing (a successful submit, or Discard)", () => {
  it("removes the draft and the pointer that pointed at it, and nothing else", () => {
    const s = memory();
    saveDraft(s, who, { match, teamNumber: 254, values: progress() }, "Qualification-12", NOW);
    saveDraft(s, who, { match: null, teamNumber: null, values: progress() }, null, NOW + 1); // pointer now at the unpicked one
    clearDraft(s, { ...who, matchKey: "Qualification-12", teamNumber: 254 });
    expect(loadDraft(s, { ...who, matchKey: "Qualification-12", teamNumber: 254 }, NOW)).toBeNull();
    expect(loadDraft(s, who, NOW)).not.toBeNull();
    expect(loadLastDraft(s, "u1", "rebuilt", NOW)).not.toBeNull(); // the pointer was elsewhere: untouched
    clearDraft(s, who);
    expect(loadLastDraft(s, "u1", "rebuilt", NOW)).toBeNull();
    expect(s.data.size).toBe(0);
  });
});

describe("storage that fails", () => {
  const broken: DraftStorage = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("quota");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };
  it("never throws: a save reports false, a load finds nothing, a clear is a no-op", () => {
    expect(saveDraft(broken, who, { match: null, teamNumber: null, values: progress() }, null, NOW)).toBe(false);
    expect(loadDraft(broken, who, NOW)).toBeNull();
    expect(loadLastDraft(broken, "u1", "rebuilt", NOW)).toBeNull();
    expect(() => clearDraft(broken, who)).not.toThrow();
  });
});

describe("draftAge", () => {
  it("reads as a person would say it", () => {
    expect(draftAge(NOW - 10_000, NOW)).toBe("just now");
    expect(draftAge(NOW - 5 * 60_000, NOW)).toBe("5 min ago");
    expect(draftAge(NOW - 3 * 3_600_000, NOW)).toBe("3 h ago");
    expect(draftAge(NOW - 72 * 3_600_000, NOW)).toBe("3 d ago");
    expect(draftAge(NOW + 5000, NOW)).toBe("just now");
  });
});

import { describe, expect, it } from "vitest";
import { docsForGame, entryMatchId, entryToDoc, formatMatchIdLong, matchGroupKey, normalizeAlliance, parseTeamNumber } from "@/lib/analytics/cs-docs";
import { rebuiltEntry } from "@/lib/analytics/cs-test-fixtures";
import { getGamePlugin } from "@/lib/games/registry";

describe("entryToDoc", () => {
  it("rebuilds a REBUILT document the plugin scores like the entry", () => {
    const entry = rebuiltEntry("a", { autoFuel: 10, teleFuel: 20, endFuel: 5, status: "level-2" });
    const doc = entryToDoc(entry);
    expect(doc).not.toBeNull();
    expect(doc?.game).toBe("REBUILT");
    expect(getGamePlugin("REBUILT").scoreDoc(doc!).total).toBe(entry.score.total);
    expect(entry.score.total).toBe(10 + 20 + 5 + 20);
  });

  it("returns null (not a throw) for an entry whose form no game owns", () => {
    const entry = { ...rebuiltEntry("a"), formId: "sample", game: undefined };
    expect(entryToDoc(entry)).toBeNull();
  });
});

describe("docsForGame", () => {
  it("keeps the game's entries and counts the rest as skipped", () => {
    const ok = rebuiltEntry("a");
    const other = { ...rebuiltEntry("b"), formId: "charged-up", game: "CHARGED_UP" as const };
    const { items, skipped } = docsForGame([ok, other], "REBUILT");
    expect(items.map((i) => i.entry.id)).toEqual(["a"]);
    expect(skipped).toBe(1);
  });
});

describe("match helpers", () => {
  it("reads the match id an entry was stored with, else maps it", () => {
    expect(entryMatchId(rebuiltEntry("a", { match: "q12" }))).toBe("q12");
    expect(entryMatchId({ matchType: "Qualification", matchNumber: 7, legacy: undefined })).toBe("q7");
  });
  it("keys a match by normalised event and short id", () => {
    expect(matchGroupKey("2026ARLI", "Q12")).toBe(matchGroupKey("2026arli", "q12"));
  });
  it("formats long labels", () => {
    expect(formatMatchIdLong("q12")).toBe("Qualification 12");
    expect(formatMatchIdLong("sf3")).toBe("Semifinal 3");
    expect(formatMatchIdLong("")).toBe("-");
  });
  it("normalises alliance and team number", () => {
    expect(normalizeAlliance("Red")).toBe("red");
    expect(normalizeAlliance("blue")).toBe("blue");
    expect(normalizeAlliance("x")).toBeNull();
    expect(parseTeamNumber("254B")).toBe(254);
    expect(parseTeamNumber("")).toBeNull();
    expect(parseTeamNumber("0")).toBeNull();
  });
});

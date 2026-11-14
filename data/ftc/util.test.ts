import { describe, expect, it } from "vitest";
import { finiteNumber, nonEmptyString, numberOr, stringList } from "@/data/ftc/util";

describe("ftc util", () => {
  it("finiteNumber only accepts finite numbers", () => {
    expect(finiteNumber(4)).toBe(4);
    expect(finiteNumber(0)).toBe(0);
    expect(finiteNumber("4")).toBeNull();
    expect(finiteNumber(NaN)).toBeNull();
    expect(finiteNumber(Infinity)).toBeNull();
    expect(finiteNumber(null)).toBeNull();
  });

  it("numberOr falls back for anything that is not a finite number", () => {
    expect(numberOr(7, 1)).toBe(7);
    expect(numberOr("7", 1)).toBe(1);
    expect(numberOr(undefined, 1)).toBe(1);
  });

  it("nonEmptyString trims and rejects blanks and non-strings", () => {
    expect(nonEmptyString("  hi ")).toBe("hi");
    expect(nonEmptyString("   ")).toBeNull();
    expect(nonEmptyString(5)).toBeNull();
  });

  it("stringList keeps only the strings", () => {
    expect(stringList(["a", 1, "b", null])).toEqual(["a", "b"]);
    expect(stringList("a")).toEqual([]);
    expect(stringList(undefined)).toEqual([]);
  });
});

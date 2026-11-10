import { describe, expect, it } from "vitest";
import { isAllianceReadyToNotify } from "./notify";

describe("isAllianceReadyToNotify", () => {
  it("is eligible when two different scouts each covered one robot", () => {
    const entries = [
      { uid: "a", submittedAt: "2026-01-01T00:00:00.000Z" },
      { uid: "b", submittedAt: "2026-01-01T00:20:00.000Z" },
    ];
    expect(isAllianceReadyToNotify(entries, 10, 2)).toBe(true);
  });

  it("is eligible when one scout covered both within the window", () => {
    const entries = [
      { uid: "a", submittedAt: "2026-01-01T00:00:00.000Z" },
      { uid: "a", submittedAt: "2026-01-01T00:05:00.000Z" },
    ];
    expect(isAllianceReadyToNotify(entries, 10, 2)).toBe(true);
  });

  it("is not eligible when one scout's two entries are outside the window", () => {
    const entries = [
      { uid: "a", submittedAt: "2026-01-01T00:00:00.000Z" },
      { uid: "a", submittedAt: "2026-01-01T00:15:00.000Z" },
    ];
    expect(isAllianceReadyToNotify(entries, 10, 2)).toBe(false);
  });

  it("takes the alliance's own size: a 3-robot alliance needs three entries", () => {
    const two = [
      { uid: "a", submittedAt: "2026-01-01T00:00:00.000Z" },
      { uid: "b", submittedAt: "2026-01-01T00:20:00.000Z" },
    ];
    expect(isAllianceReadyToNotify(two, 10, 3)).toBe(false);
    expect(isAllianceReadyToNotify([...two, { uid: "c", submittedAt: "2026-01-01T01:00:00.000Z" }], 10, 3)).toBe(true);
  });

  it("with 3 robots, one scout's entries must all fall inside the window", () => {
    const entry = (uid: string, minute: number) => ({ uid, submittedAt: new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString() });
    expect(isAllianceReadyToNotify([entry("a", 0), entry("a", 4), entry("b", 30)], 10, 3)).toBe(true);
    expect(isAllianceReadyToNotify([entry("a", 0), entry("a", 15), entry("b", 16)], 10, 3)).toBe(false);
    expect(isAllianceReadyToNotify([entry("a", 0), entry("a", 5), entry("a", 9)], 10, 3)).toBe(true);
    expect(isAllianceReadyToNotify([entry("a", 0), entry("a", 5), entry("a", 11)], 10, 3)).toBe(false);
  });

  it("is not eligible when the alliance isn't fully covered", () => {
    expect(isAllianceReadyToNotify([{ uid: "a", submittedAt: "2026-01-01T00:00:00.000Z" }], 10, 2)).toBe(false);
    expect(isAllianceReadyToNotify([], 10, 2)).toBe(false);
  });
});

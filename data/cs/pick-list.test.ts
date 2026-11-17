import { describe, expect, it } from "vitest";
import { csPickListMeta, csPickListToPicked, pickedToCsPickList } from "@/data/cs/pick-list";

/** `teams/{id}.pickList` exactly as CS's pick-list page writes it. */
const csPickList = {
  picks: [
    { teamNumber: "971", pickOrder: 2 },
    { teamNumber: "254", pickOrder: 1 },
    { teamNumber: "1678", pickOrder: 3 },
  ],
  updatedAt: 1_700_000_000_000,
  updatedBy: "uid-lead",
};

describe("csPickListToPicked", () => {
  it("orders by pickOrder and reads string team numbers", () => {
    expect(csPickListToPicked(csPickList)).toEqual([254, 971, 1678]);
  });

  it("falls back to stored order, drops junk and duplicates", () => {
    expect(csPickListToPicked({ picks: [{ teamNumber: "5" }, { teamNumber: "" }, { teamNumber: 7 }, { teamNumber: "5", pickOrder: 9 }, null, 4] })).toEqual([5, 7]);
    expect(csPickListToPicked(undefined)).toEqual([]);
    expect(csPickListToPicked({ picks: "x" })).toEqual([]);
  });

  it("meta is the editor uid and the ms timestamp (CS keeps no name)", () => {
    expect(csPickListMeta(csPickList)).toEqual({ updatedBy: "uid-lead", updatedAtMs: 1_700_000_000_000 });
    expect(csPickListMeta(undefined)).toEqual({ updatedBy: null, updatedAtMs: null });
    expect(csPickListMeta({ updatedAt: 0, updatedBy: "" })).toEqual({ updatedBy: null, updatedAtMs: null });
  });
});

describe("pickedToCsPickList", () => {
  it("writes CS's shape: string teamNumber, 1-based pickOrder, ms updatedAt, uid updatedBy", () => {
    expect(pickedToCsPickList(undefined, [971, 254], "uid-me", 42)).toEqual({
      picks: [
        { teamNumber: "971", pickOrder: 1 },
        { teamNumber: "254", pickOrder: 2 },
      ],
      updatedAt: 42,
      updatedBy: "uid-me",
    });
  });

  it("an empty list is written as an empty picks array (CS reads it as no picks)", () => {
    expect(pickedToCsPickList(csPickList, [], "uid-me", 1)).toMatchObject({ picks: [], updatedBy: "uid-me" });
  });

  it("carries over unknown fields of the stored list and of an existing pick (D10)", () => {
    const stored = { ...csPickList, note: "keep me", picks: [{ teamNumber: "254", pickOrder: 1, tag: "dream" }, { teamNumber: "971", pickOrder: 2 }] };
    const next = pickedToCsPickList(stored, [971, 254, 118], "uid-me", 5) as { picks: Array<Record<string, unknown>>; note: string };
    expect(next.note).toBe("keep me");
    expect(next.picks).toEqual([
      { teamNumber: "971", pickOrder: 1 },
      { teamNumber: "254", pickOrder: 2, tag: "dream" },
      { teamNumber: "118", pickOrder: 3 },
    ]);
  });

  it("round trips through the reader", () => {
    expect(csPickListToPicked(pickedToCsPickList(csPickList, [118, 254], "u", 1))).toEqual([118, 254]);
  });
});

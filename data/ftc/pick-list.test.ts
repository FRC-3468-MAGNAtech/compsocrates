import { describe, expect, it } from "vitest";
import { ftcDocToPickList, ftcPickListDoc, ftcPickListId } from "@/data/ftc/pick-list";

describe("pick list documents", () => {
  it("the id is the team and the event", () => {
    expect(ftcPickListId("team1", "USTXAUS1")).toBe("team1_USTXAUS1");
  });

  it("reads a stored list, with the editor and the time", () => {
    expect(ftcDocToPickList({ teamId: "t", eventCode: "EV", picked: [254, 1678, 971], updatedBy: "u1", updatedByName: "Ada", updatedAt: { toMillis: () => 5000 } })).toEqual({
      teamId: "t",
      eventCode: "EV",
      picked: [254, 1678, 971],
      updatedBy: "u1",
      updatedByName: "Ada",
      updatedAtMs: 5000,
    });
  });

  it("cleans the picks (no repeats, no non-teams) and reads a pending time as null", () => {
    const list = ftcDocToPickList({ teamId: "t", eventCode: "EV", picked: [5, 5, "x", -1, 0, 9], updatedAt: null });
    expect(list.picked).toEqual([5, 9]);
    expect(list.updatedAtMs).toBeNull();
    expect(list.updatedBy).toBeNull();
  });

  it("a sparse doc is an empty list", () => {
    expect(ftcDocToPickList({})).toEqual({ teamId: "", eventCode: "", picked: [], updatedBy: null, updatedByName: null, updatedAtMs: null });
  });

  it("writes the picks, the editor's own uid and name, and the time it is given", () => {
    expect(ftcPickListDoc({ teamId: "t", eventCode: "EV", uid: "u1", name: "Ada" }, [3, 1, 2], () => "NOW")).toEqual({ teamId: "t", eventCode: "EV", picked: [3, 1, 2], updatedBy: "u1", updatedByName: "Ada", updatedAt: "NOW" });
  });
});

import { describe, expect, it } from "vitest";
import { ftcAttendanceDoc, ftcAttendanceDocId, ftcDocsToAttendance, ftcDocToAttendance } from "@/data/ftc/attendance";

describe("event attendance documents", () => {
  it("the id is the team and the event", () => {
    expect(ftcAttendanceDocId("team1", "USTXAUS1")).toBe("team1_USTXAUS1");
  });

  it("reads a stored record, keeping the event code exactly as stored", () => {
    expect(ftcDocToAttendance("team1_USTXAUS1", { teamId: "team1", eventCode: "USTXAUS1", uids: ["a", "b"], updatedAt: 5 })).toEqual({ id: "team1_USTXAUS1", teamId: "team1", eventCode: "USTXAUS1", uids: ["a", "b"], updatedAt: 5 });
  });

  it("a sparse doc attends with nobody, and a list holding junk keeps only the uids", () => {
    expect(ftcDocToAttendance("x", {})).toEqual({ id: "x", teamId: "", eventCode: "", uids: [], updatedAt: null });
    expect(ftcDocToAttendance("x", { uids: ["a", 1, null, "b"] }).uids).toEqual(["a", "b"]);
  });

  it("converts rows in order and skips bodies that are not maps", () => {
    const records = ftcDocsToAttendance([
      { id: "1", data: { teamId: "t", eventCode: "A", uids: ["u"] } },
      { id: "2", data: null },
      { id: "3", data: { teamId: "t", eventCode: "B", uids: [] } },
    ]);
    expect(records.map((r) => r.id)).toEqual(["1", "3"]);
  });

  it("writes the team, the event, the uids without duplicates, and the time it is given", () => {
    expect(ftcAttendanceDoc("t", "EV", ["a", "b", "a"], () => "NOW")).toEqual({ teamId: "t", eventCode: "EV", uids: ["a", "b"], updatedAt: "NOW" });
  });
});

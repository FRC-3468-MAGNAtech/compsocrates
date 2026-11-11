import { describe, expect, it } from "vitest";
import { collectEventKeys, collectStoredEventNames } from "@/lib/events/stored-names";

describe("collectStoredEventNames", () => {
  it("collects names from rows keyed by eventKey or eventCode", () => {
    expect(
      collectStoredEventNames([
        { eventKey: "2026arli", eventName: "Arkansas Regional" },
        { eventCode: "2026lake", eventName: "Bayou Regional" },
      ])
    ).toEqual({ "2026arli": "Arkansas Regional", "2026lake": "Bayou Regional" });
  });

  it("skips empty names, names equal to the key (CS writes eventName || eventKey) and rows without a key", () => {
    expect(
      collectStoredEventNames([
        { eventKey: "2026arli", eventName: "2026arli" },
        { eventKey: "2026lake", eventName: "  " },
        { eventName: "No key" },
        { eventKey: "2026okok", eventName: undefined },
        null as never,
      ])
    ).toEqual({});
  });

  it("normalizes keys (case, alias) and the first usable name wins", () => {
    expect(
      collectStoredEventNames(
        { "2026LAKE": "The team's Bayou" },
        [{ eventKey: "2025lake", eventName: "Bayou Regional" }, { eventKey: "2026lake", eventName: "Later" }]
      )
    ).toEqual({ "2026lake": "The team's Bayou" });
  });

  it("keeps looking when an earlier row for a key had no usable name", () => {
    expect(
      collectStoredEventNames([
        { eventKey: "2026lake", eventName: "2026lake" },
        { eventKey: "2026lake", eventName: "Bayou Regional" },
      ])
    ).toEqual({ "2026lake": "Bayou Regional" });
  });

  it("rejects a name equal to the key as typed before aliasing", () => {
    expect(collectStoredEventNames([{ eventKey: "2025lake", eventName: "2025lake" }])).toEqual({});
  });

  it("accepts null and undefined sources", () => {
    expect(collectStoredEventNames(undefined, null, [])).toEqual({});
  });
});

describe("collectEventKeys", () => {
  it("collects distinct normalized keys from eventKey and eventCode, in first-seen order", () => {
    expect(
      collectEventKeys([{ eventKey: "2026LAKE" }, { eventCode: "2026arli" }, { eventKey: "2025lake" }, { eventKey: "" }, {}], undefined, [{ eventCode: "2026arli" }])
    ).toEqual(["2026lake", "2026arli"]);
  });
});

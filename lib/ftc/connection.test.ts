import { describe, expect, it } from "vitest";
import { isPathConnected, PROGRAMS } from "@/config/programs";

describe("program connection config", () => {
  it("the default program has every path and feature connected, and one team per account", () => {
    const frc = PROGRAMS.frc;
    expect(frc.connection.paths).toBe("all");
    expect(Object.values(frc.connection.features).every(Boolean)).toBe(true);
    expect(frc.multiTeam).toBe(false);
    expect(isPathConnected("frc", "/anything/at/all")).toBe(true);
  });

  it("the FTC program connects the scout page, Active Events, the Match List and the scout-entry analytics so far, and allows several teams per account", () => {
    expect(PROGRAMS.ftc.multiTeam).toBe(true);
    expect(PROGRAMS.ftc.connection.paths).toEqual(["/scout", "/event", "/match-list", "/analytics/match-scout", "/analytics/team-averages", "/analytics/team-breakdown", "/analytics/rankings"]);
    for (const path of ["/scout", "/scout/anything", "/event", "/match-list", "/analytics/match-scout", "/analytics/rankings", "/analytics/team-breakdown", "/analytics/team-averages"]) expect(isPathConnected("ftc", path), path).toBe(true);
    // everything else shows the notice, including the neighbours of a connected path
    for (const path of ["/", "/dashboard", "/match-lists", "/events", "/eventual", "/scouting", "/scoutish", "/analytics", "/analytics/match-scoutish", "/analytics/pick-list", "/analytics/scout-status", "/analytics/match-breakdown", "/analytics/lead-scout", "/my-scouting", "/judge-book"]) {
      expect(isPathConnected("ftc", path), path).toBe(false);
    }
  });

  it("no data feature is on for FTC until it has a program-aware data layer", () => {
    expect(Object.values(PROGRAMS.ftc.connection.features).some(Boolean)).toBe(false);
  });

  it("every path a program lists as unavailable is also unconnected for it", () => {
    for (const program of Object.values(PROGRAMS)) for (const path of program.unavailablePaths) expect(isPathConnected(program.id, path), path).toBe(program.connection.paths === "all");
  });
});

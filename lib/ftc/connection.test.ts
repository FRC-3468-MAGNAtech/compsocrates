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

  it("the FTC program connects exactly the pages that have a program-aware data layer, and allows several teams per account", () => {
    const connected = [
      "/scout", "/event", "/match-list",
      "/lead-scout-form", "/pit-scout-form", "/team-strategy-form", "/match-strategy-form", "/drive-reflection-form", "/helper-form",
      "/people", "/team-management",
      "/analytics/match-scout", "/analytics/lead-scout", "/analytics/pit-scout", "/analytics/team-strategy", "/analytics/match-strategy", "/analytics/drive-reflection", "/analytics/helper",
      "/analytics/team-averages", "/analytics/team-breakdown", "/analytics/rankings",
    ];
    expect(PROGRAMS.ftc.multiTeam).toBe(true);
    expect([...(PROGRAMS.ftc.connection.paths as readonly string[])].sort()).toEqual([...connected].sort());
    for (const path of [...connected, "/scout/anything", "/pit-scout-form/x"]) expect(isPathConnected("ftc", path), path).toBe(true);
    // everything else shows the notice, including the neighbours of a connected path
    for (const path of ["/", "/dashboard", "/match-lists", "/events", "/eventual", "/scouting", "/scoutish", "/analytics", "/analytics/match-scoutish", "/analytics/pick-list", "/analytics/scout-status", "/analytics/match-breakdown", "/my-scouting", "/judge-book", "/pit-scout-forms"]) {
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

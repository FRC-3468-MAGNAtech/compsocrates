import { describe, expect, it } from "vitest";
import { isPathConnected, isUnavailableInProgram, PROGRAMS } from "@/config/programs";

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
      "/scout", "/event", "/assignments", "/match-list",
      "/lead-scout-form", "/pit-scout-form", "/team-strategy-form", "/match-strategy-form", "/drive-reflection-form", "/helper-form",
      "/dashboard", "/my-scouting", "/people", "/team-management", "/account", "/profile", "/credits", "/analytics",
      "/analytics/match-scout", "/analytics/lead-scout", "/analytics/pit-scout", "/analytics/team-strategy", "/analytics/match-strategy", "/analytics/drive-reflection", "/analytics/helper",
      "/analytics/pick-list", "/analytics/scout-status", "/analytics/match-breakdown", "/analytics/teams", "/analytics/team-averages", "/analytics/team-breakdown", "/analytics/rankings", "/admin",
    ];
    expect(PROGRAMS.ftc.multiTeam).toBe(true);
    expect([...(PROGRAMS.ftc.connection.paths as readonly string[])].sort()).toEqual([...connected].sort());
    for (const path of [...connected, "/scout/anything", "/pit-scout-form/x", "/analytics/teams/4242"]) expect(isPathConnected("ftc", path), path).toBe(true);
    // everything else shows the notice, including the neighbours of a connected path
    for (const path of ["/", "/dashboards", "/match-lists", "/events", "/eventual", "/scouting", "/scoutish", "/analytics-x", "/analytics/accuracy-compare", "/analytics/robot-radar", "/events/2025casj", "/my-scouting-x", "/judge-book", "/pit-scout-forms"]) {
      expect(isPathConnected("ftc", path), path).toBe(false);
    }
  });

  it("only the data features FTC has a program-aware layer for are on", () => {
    const on = Object.entries(PROGRAMS.ftc.connection.features).filter(([, enabled]) => enabled).map(([name]) => name);
    expect(on).toEqual(["assignments", "library", "pickList", "joinRequests", "eventLookup"]);
    // csvImport, practice, live and accuracy stay off until their data layers are ported
    for (const off of ["csvImport", "practice", "live", "accuracy"] as const) expect(PROGRAMS.ftc.connection.features[off], off).toBe(false);
  });

  it("every path a program lists as unavailable is also unconnected for it", () => {
    for (const program of Object.values(PROGRAMS)) for (const path of program.unavailablePaths) expect(isPathConnected(program.id, path), path).toBe(program.connection.paths === "all");
  });
});

describe("unavailable pages", () => {
  it("a single event page is FRC-only: unavailable in FTC for any event key, available in FRC", () => {
    expect(isUnavailableInProgram("ftc", "/events/2025casj")).toBe(true);
    expect(isUnavailableInProgram("ftc", "/events/USCAGENT")).toBe(true);
    expect(isUnavailableInProgram("ftc", "/events")).toBe(false);
    expect(isUnavailableInProgram("ftc", "/event")).toBe(false);
    expect(isUnavailableInProgram("frc", "/events/2025casj")).toBe(false);
  });

  it("the analytics index is connected for FTC but the FRC-only analytics pages under it are not", () => {
    expect(isPathConnected("ftc", "/analytics")).toBe(true);
    expect(isPathConnected("ftc", "/analytics/match-prediction")).toBe(false);
    expect(isPathConnected("ftc", "/analytics/rankings")).toBe(true);
  });
});

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
      "/practice-scouting", "/scout-accuracy", "/team-settings", "/changelog", "/analytics/pick-list", "/analytics/scout-status", "/analytics/match-breakdown", "/analytics/teams", "/analytics/team-averages", "/analytics/team-breakdown", "/analytics/rankings", "/admin",
      "/events/[eventKey]", "/analytics/performance-reliability", "/analytics/robot-radar",
    ];
    expect(PROGRAMS.ftc.multiTeam).toBe(true);
    expect([...(PROGRAMS.ftc.connection.paths as readonly string[])].sort()).toEqual([...connected].sort());
    for (const path of [...connected, "/scout/anything", "/pit-scout-form/x", "/analytics/teams/4242", "/events/2025-USCALAB"]) expect(isPathConnected("ftc", path), path).toBe(true);
    // everything else shows the notice, including the neighbours of a connected path
    for (const path of ["/", "/dashboards", "/match-lists", "/events", "/eventual", "/scouting", "/scoutish", "/analytics-x", "/analytics/accuracy-compare", "/my-scouting-x", "/judge-book", "/pit-scout-forms"]) {
      expect(isPathConnected("ftc", path), path).toBe(false);
    }
  });

  it("only the data features FTC has a program-aware layer for are on", () => {
    const on = Object.entries(PROGRAMS.ftc.connection.features).filter(([, enabled]) => enabled).map(([name]) => name);
    expect(on).toEqual(["assignments", "practice", "live", "lobby", "library", "pickList", "accuracy", "csvImport", "changelog", "joinRequests", "eventLookup"]);
    // live and lobby went on in Batch 6 (their presence and lobby data layers read by path, never by collection group)
    for (const on of ["live", "lobby"] as const) expect(PROGRAMS.ftc.connection.features[on], on).toBe(true);
    // the default program has live and lobby on, as before
    expect(PROGRAMS.frc.connection.features.live).toBe(true);
    expect(PROGRAMS.frc.connection.features.lobby).toBe(true);
  });

  it("every path a program lists as unavailable is also unconnected for it", () => {
    for (const program of Object.values(PROGRAMS)) for (const path of program.unavailablePaths) expect(isPathConnected(program.id, path), path).toBe(program.connection.paths === "all");
  });
});

describe("unavailable pages", () => {
  it("a single event page is available in both programs for any event key; the bare /events path is still not a page", () => {
    for (const program of ["ftc", "frc"] as const) {
      expect(isUnavailableInProgram(program, "/events/2025casj")).toBe(false);
      expect(isUnavailableInProgram(program, "/events/2025-USCALAB")).toBe(false);
      expect(isPathConnected(program, "/events/2025-USCALAB")).toBe(true);
    }
    expect(isPathConnected("ftc", "/events")).toBe(false);
    expect(isUnavailableInProgram("ftc", "/event")).toBe(false);
  });

  it("the analytics index is connected for FTC but the FRC-only analytics pages under it are not", () => {
    expect(isPathConnected("ftc", "/analytics")).toBe(true);
    expect(isPathConnected("ftc", "/analytics/match-prediction")).toBe(false);
    expect(isPathConnected("ftc", "/analytics/rankings")).toBe(true);
  });
});

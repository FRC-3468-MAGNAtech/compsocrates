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

  it("the FTC program connects only the scout page so far, and allows several teams per account", () => {
    expect(PROGRAMS.ftc.multiTeam).toBe(true);
    expect(PROGRAMS.ftc.connection.paths).toEqual(["/scout"]);
    expect(isPathConnected("ftc", "/scout")).toBe(true);
    expect(isPathConnected("ftc", "/scout/anything")).toBe(true);
    for (const path of ["/", "/dashboard", "/match-list", "/scouting", "/scoutish", "/analytics/team-stats", "/judge-book"]) expect(isPathConnected("ftc", path), path).toBe(false);
  });

  it("no data feature is on for FTC until it has a program-aware data layer", () => {
    expect(Object.values(PROGRAMS.ftc.connection.features).some(Boolean)).toBe(false);
  });

  it("every path a program lists as unavailable is also unconnected for it", () => {
    for (const program of Object.values(PROGRAMS)) for (const path of program.unavailablePaths) expect(isPathConnected(program.id, path), path).toBe(program.connection.paths === "all");
  });
});

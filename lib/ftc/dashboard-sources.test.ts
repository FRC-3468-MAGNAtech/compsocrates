import { describe, expect, it } from "vitest";
import { PROGRAMS } from "@/config/programs";
import { connectedSources, sourcesFor, type DashboardSource } from "@/lib/dashboard/roles";
import { ROLES } from "@/lib/roles";

describe("the dashboard sources a program has connected", () => {
  const all = new Set<DashboardSource>(["members", "sessions", "library", "attendance", "assignments", "pickList", "formEntries", "teamAssignments"]);

  it("a program with every feature reads every source a role asks for, unchanged", () => {
    for (const role of ROLES) for (const admin of [false, true]) {
      const wanted = sourcesFor(role.id, admin);
      expect([...connectedSources(wanted, PROGRAMS.frc.connection.features)].sort()).toEqual([...wanted].sort());
    }
  });

  it("a program without practice, library, assignments or the pick list does not read those sources, and still reads the rest", () => {
    const got = connectedSources(all, PROGRAMS.ftc.connection.features);
    expect([...got].sort()).toEqual(["attendance", "formEntries", "members"]);
  });

  it("only the features a source needs matter", () => {
    const features = { ...PROGRAMS.ftc.connection.features, practice: true, assignments: true };
    expect([...connectedSources(all, features)].sort()).toEqual(["assignments", "attendance", "formEntries", "members", "sessions", "teamAssignments"]);
  });
});

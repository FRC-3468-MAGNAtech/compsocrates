import { describe, expect, it } from "vitest";
import { allianceSlots } from "@/config/alliance";
import { DRIVE_REFLECTION_REBUILT_FORM, LEAD_SCOUT_REBUILT_FORM, MATCH_STRATEGY_REBUILT_FORM } from "@/lib/forms/builtin-rebuilt-forms";
import { teamFillFor, teamFillTargets } from "@/lib/forms/team-fill";
import type { Form } from "@/lib/forms/types";

/** A form whose "Teams" group repeats per alliance team, each box holding a team picker (stored `t1_team` ..): the shape of the 2-team-alliance forms. */
const repeating = {
  sections: [
    {
      id: "teams",
      title: "Teams",
      phase: "misc",
      visible: true,
      groups: [{ id: "g", title: "Teams", repeat: { source: "allianceTeams", maxSlots: 3 } }],
      fields: [{ id: "f-team", key: "team", type: "teamPicker", label: "Team", groupId: "g" }],
    },
  ],
} as unknown as Pick<Form, "sections">;

describe("teamFillFor", () => {
  it.each([
    ["Lead Scout", LEAD_SCOUT_REBUILT_FORM],
    ["Match Strategy", MATCH_STRATEGY_REBUILT_FORM],
    ["Drive Reflection", DRIVE_REFLECTION_REBUILT_FORM],
  ])("fills each robot's team number on the %s form, as text, in alliance order", (_n, form) => {
    expect(teamFillFor(form, [111, 222, 333], {})).toMatchObject({ robot1_teamNumber: "111", robot2_teamNumber: "222", robot3_teamNumber: "333" });
  });

  it("fills the team pickers of a repeating group with numbers; a 2-team alliance leaves slot 3 alone", () => {
    const out = teamFillFor(repeating, [111, 222], {});
    expect(out?.t1_team).toBe(111);
    expect(out?.t2_team).toBe(222);
    expect(out).not.toHaveProperty("t3_team");
  });

  it("targets positions 1..n in order, for 3-robot and 2-robot alliance sizes", () => {
    expect(teamFillTargets(LEAD_SCOUT_REBUILT_FORM).map((t) => t.slot)).toEqual([1, 2, 3]);
    expect(teamFillTargets(repeating).map((t) => t.storageKey)).toEqual(["t1_team", "t2_team", "t3_team"]);
    expect(allianceSlots(3)).toHaveLength(6);
    expect(allianceSlots(2)).toHaveLength(4);
  });

  it("leaves touched fields, fields already right and positions without a team alone; null when nothing changes", () => {
    const form = LEAD_SCOUT_REBUILT_FORM;
    expect(teamFillFor(form, [111, 222, 333], {}, new Set(["robot2_teamNumber"]))).not.toHaveProperty("robot2_teamNumber");
    expect(teamFillFor(form, [111, 222, 333], { robot1_teamNumber: "111", robot2_teamNumber: "222", robot3_teamNumber: "333" })).toBeNull();
    expect(teamFillFor(form, [111, 222], {})).not.toHaveProperty("robot3_teamNumber");
    expect(teamFillFor(form, [], {})).toBeNull();
  });

  it("replaces another match's teams when the alliance changes", () => {
    expect(teamFillFor(LEAD_SCOUT_REBUILT_FORM, [7, 8, 9], { robot1_teamNumber: "111" })?.robot1_teamNumber).toBe("7");
  });
});

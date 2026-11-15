import { describe, expect, it } from "vitest";
import { csTeamToTeamDoc } from "@/data/cs/teams";
import { ftcTeamToTeamDoc } from "@/data/ftc/teams";
import { isSubmissionOpen } from "@/lib/forms/submission-settings";

// The additive `formSubmissionSettings` field survives the team doc normalizers of both programs, and a team without it is fully open.
describe("formSubmissionSettings on the team doc", () => {
  const stored = { enabled: true, seasons: { reefscape: false, rebuilt: true }, updatedBy: { uid: "u1", name: "Ada" }, updatedAtMs: 42 };

  it("is read from the root (FRC) team doc", () => {
    const team = csTeamToTeamDoc("T1", { teamName: "T", formSubmissionSettings: stored } as never);
    expect(team.formSubmissionSettings).toEqual({ enabled: true, seasons: { reefscape: false }, updatedBy: { uid: "u1", name: "Ada" }, updatedAtMs: 42 });
    expect(isSubmissionOpen(team.formSubmissionSettings, "reefscape")).toBe(false);
    expect(isSubmissionOpen(team.formSubmissionSettings, "rebuilt")).toBe(true);
  });

  it("is read from the FTC team doc", () => {
    const team = ftcTeamToTeamDoc("ABCD2345", { name: "T", formSubmissionSettings: { enabled: false } });
    expect(team.formSubmissionSettings?.enabled).toBe(false);
    expect(isSubmissionOpen(team.formSubmissionSettings, "biobuzz")).toBe(false);
  });

  it("a team doc without it has no field at all, and everything is open", () => {
    const frc = csTeamToTeamDoc("T1", { teamName: "T" } as never);
    const ftc = ftcTeamToTeamDoc("ABCD2345", { name: "T" });
    expect(frc).not.toHaveProperty("formSubmissionSettings");
    expect(ftc).not.toHaveProperty("formSubmissionSettings");
    expect(isSubmissionOpen(frc.formSubmissionSettings, "rebuilt")).toBe(true);
    expect(isSubmissionOpen(ftc.formSubmissionSettings, "biobuzz")).toBe(true);
  });
});

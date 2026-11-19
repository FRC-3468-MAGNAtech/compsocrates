import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ saveScout: vi.fn(), updateScout: vi.fn(), saveForm: vi.fn(), updateForm: vi.fn(), adminForm: vi.fn(), editOwn: vi.fn(), other: vi.fn() }));
vi.mock("@/data/ftc/write", () => ({
  saveScoutEntry: (...args: unknown[]) => h.saveScout(...args),
  updateScoutEntry: (...args: unknown[]) => h.updateScout(...args),
  deleteScoutEntry: (...args: unknown[]) => h.other(...args),
  importScoutEntries: (...args: unknown[]) => h.other(...args),
  setEventAttendance: (...args: unknown[]) => h.other(...args),
  editPickList: (...args: unknown[]) => h.other(...args),
  updateUserProfile: (...args: unknown[]) => h.other(...args),
  updateUserFields: (...args: unknown[]) => h.other(...args),
  publishAssignments: (...args: unknown[]) => h.other(...args),
  undoAssignments: (...args: unknown[]) => h.other(...args),
  swapAssignmentSlot: (...args: unknown[]) => h.other(...args),
  createTeam: (...args: unknown[]) => h.other(...args),
  requestToJoinTeam: (...args: unknown[]) => h.other(...args),
  publishTeamAssignments: (...args: unknown[]) => h.other(...args),
  undoTeamAssignments: (...args: unknown[]) => h.other(...args),
  updateMemberAccess: (...args: unknown[]) => h.other(...args),
  setActiveEvents: (...args: unknown[]) => h.other(...args),
  setArchivedEvents: (...args: unknown[]) => h.other(...args),
  setFormSubmissionSettings: (...args: unknown[]) => h.other(...args),
  setAllowMemberRoleChoice: (...args: unknown[]) => h.other(...args),
  setAccountName: (...args: unknown[]) => h.other(...args),
  saveAccountTeams: (...args: unknown[]) => h.other(...args),
  setActiveForm: (...args: unknown[]) => h.other(...args),
  saveFormEntry: (...args: unknown[]) => h.saveForm(...args),
  updateFormEntry: (...args: unknown[]) => h.updateForm(...args),
  editOwnFormEntry: (...args: unknown[]) => h.editOwn(...args),
  adminUpdateFormEntry: (...args: unknown[]) => h.adminForm(...args),
  deleteFormEntry: (...args: unknown[]) => h.other(...args),
}));

import { assertSubmissionOpen, clearRememberedSubmissionSettings, currentSubmissionBlock, rememberSubmissionSettings } from "@/lib/forms/submission-guard";
import { readFormSubmissionSettings, SubmissionClosedError } from "@/lib/forms/submission-settings";
import { adminUpdateFormEntry, editOwnFormEntry, saveFormEntry } from "@/lib/form-entries";
import { saveEntry, updateEntry, type SaveEntryInput } from "@/lib/scout-entries";
import { setFormSubmissionSettings } from "@/lib/team";

const TEAM = "team-a";
const scout: SaveEntryInput = {
  scoutName: "Ada",
  eventCode: "EV1",
  matchType: "Qualification",
  matchNumber: 3,
  teamNumber: 100,
  formId: "biobuzz",
  formVersion: 1,
  values: { autoLeave: true },
  score: { auto: 3, teleop: 0, endgame: 0, total: 3 },
  comments: "",
};
const pit = { scoutName: "Pia", formId: "pit-scout-v1", formVersion: 1, formType: "pit-scout", eventCode: "EV1", values: {} } as const;

const settings = (raw: unknown) => rememberSubmissionSettings("ftc", TEAM, readFormSubmissionSettings(raw));

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset();
  clearRememberedSubmissionSettings();
});

describe("the shared write path", () => {
  it("writes when the team has no settings (a missing field means on) or has not loaded", async () => {
    await saveEntry(TEAM, "u", scout, "ftc");
    settings(undefined);
    await saveEntry(TEAM, "u", { ...scout, gate: { seasonId: "biobuzz" } }, "ftc");
    await saveFormEntry(TEAM, "u", { ...pit, gate: { seasonId: "biobuzz" } }, "ftc");
    expect(h.saveScout).toHaveBeenCalledTimes(2);
    expect(h.saveForm).toHaveBeenCalledTimes(1);
  });

  it("master off: no new entry is written, by either writer, and the message says why", async () => {
    settings({ enabled: false });
    await expect(saveEntry(TEAM, "u", { ...scout, gate: { seasonId: "biobuzz" } }, "ftc")).rejects.toBeInstanceOf(SubmissionClosedError);
    await expect(saveFormEntry(TEAM, "u", { ...pit, gate: { seasonId: "biobuzz" } }, "ftc")).rejects.toThrow("Form submissions are turned off by your team admin");
    await expect(saveEntry(TEAM, "u", scout, "ftc")).rejects.toBeInstanceOf(SubmissionClosedError);
    expect(h.saveScout).not.toHaveBeenCalled();
    expect(h.saveForm).not.toHaveBeenCalled();
  });

  it("season off: that season is refused with its game's name, the other seasons still write", async () => {
    settings({ seasons: { reefscape: false } });
    await expect(saveEntry(TEAM, "u", { ...scout, gate: { seasonId: "reefscape" } }, "ftc")).rejects.toThrow("Submissions for REEFSCAPE are turned off by your team admin");
    await expect(saveFormEntry(TEAM, "u", { ...pit, gate: { seasonId: "reefscape" } }, "ftc")).rejects.toThrow(SubmissionClosedError);
    expect(h.saveScout).not.toHaveBeenCalled();
    await saveEntry(TEAM, "u", { ...scout, gate: { seasonId: "rebuilt" } }, "ftc");
    await saveFormEntry(TEAM, "u", { ...pit, gate: { seasonId: "charged_up" } }, "ftc");
    expect(h.saveScout).toHaveBeenCalledTimes(1);
    expect(h.saveForm).toHaveBeenCalledTimes(1);
  });

  it("names CHARGED UP with a space", () => {
    settings({ seasons: { charged_up: false } });
    expect(currentSubmissionBlock("ftc", TEAM, "charged_up")?.message).toBe("Submissions for CHARGED UP are turned off by your team admin");
  });

  it("is per team and per program", async () => {
    settings({ enabled: false });
    await saveEntry("team-b", "u", scout, "ftc");
    expect(() => assertSubmissionOpen("frc", TEAM)).not.toThrow();
    expect(() => assertSubmissionOpen("ftc", TEAM)).toThrow(SubmissionClosedError);
    expect(h.saveScout).toHaveBeenCalledTimes(1);
  });

  it("Practice Scouting is never closed, even with the master switch off", async () => {
    settings({ enabled: false, seasons: { biobuzz: false } });
    await saveEntry(TEAM, "u", { ...scout, source: "practice", mode: "trial", sessionId: "s1" }, "ftc");
    await saveEntry(TEAM, "u", { ...scout, source: "live", sessionId: "s2" }, "ftc");
    expect(h.saveScout).toHaveBeenCalledTimes(2);
    await expect(saveEntry(TEAM, "u", { ...scout, source: "event" }, "ftc")).rejects.toBeInstanceOf(SubmissionClosedError);
  });

  it("an admin's import (bypass) is not a scout submitting", async () => {
    settings({ enabled: false });
    await saveEntry(TEAM, "u", { ...scout, gate: { bypass: true } }, "ftc");
    await saveFormEntry(TEAM, "u", { ...pit, gate: { bypass: true } }, "ftc");
    expect(h.saveScout).toHaveBeenCalledTimes(1);
    expect(h.saveForm).toHaveBeenCalledTimes(1);
  });
});

describe("the admin entry editor while submissions are off", () => {
  it("still edits: updates and admin changes are never gated", async () => {
    settings({ enabled: false, seasons: { biobuzz: false } });
    h.updateScout.mockResolvedValue(undefined);
    h.adminForm.mockResolvedValue(undefined);
    h.editOwn.mockResolvedValue(undefined);
    await updateEntry("e1", { excluded: true }, {}, "ftc");
    await adminUpdateFormEntry("fe1", { excluded: true }, "ftc");
    await editOwnFormEntry({ teamId: TEAM, uid: "u1", name: "Pia" }, { id: "fe1", formId: "pit-scout-v1", eventCode: "EV1", teamNumber: 1, values: {}, stickyNotes: [] }, { values: {}, stickyNotes: [] }, "ftc");
    expect(h.updateScout).toHaveBeenCalledWith("e1", { excluded: true });
    expect(h.adminForm).toHaveBeenCalledTimes(1);
    expect(h.editOwn).toHaveBeenCalledTimes(1);
  });

  it("an admin can still change the switches themselves", async () => {
    settings({ enabled: false });
    await setFormSubmissionSettings(TEAM, readFormSubmissionSettings({ enabled: true }), "ftc");
    expect(h.other).toHaveBeenCalledWith(TEAM, { enabled: true, seasons: {} });
  });
});

describe("entries queued offline when a switch changes", () => {
  it("an entry handed to the offline queue while submissions were open stays accepted; a new one after the switch is refused, offline too", async () => {
    // offline and open: the write is accepted into Firestore's own queue (the port's promise stays pending until the server answers)
    settings({ enabled: true });
    let ack: () => void = () => undefined;
    h.saveScout.mockImplementationOnce(() => new Promise<void>((resolve) => (ack = resolve)));
    const queued = saveEntry(TEAM, "u", { ...scout, gate: { seasonId: "biobuzz" } }, "ftc");
    // an admin closes the season; this device learns of it from the cached team doc (it works offline)
    settings({ seasons: { biobuzz: false } });
    await expect(saveEntry(TEAM, "u", { ...scout, gate: { seasonId: "biobuzz" } }, "ftc")).rejects.toBeInstanceOf(SubmissionClosedError);
    // the queued one is neither dropped nor blocked (the client cannot recall a write it already queued): it syncs when the device is back online
    ack();
    await expect(queued).resolves.toBeUndefined();
    expect(h.saveScout).toHaveBeenCalledTimes(1);
  });

  it("a device that has never seen the settings (cold offline start) is open: a scout never loses an entry to a read that did not happen", async () => {
    await saveEntry(TEAM, "u", { ...scout, gate: { seasonId: "biobuzz" } }, "ftc");
    expect(h.saveScout).toHaveBeenCalledTimes(1);
  });

  it("turning the switch back on lets new entries through again", async () => {
    settings({ enabled: false });
    await expect(saveEntry(TEAM, "u", scout, "ftc")).rejects.toBeInstanceOf(SubmissionClosedError);
    settings({ enabled: true });
    await saveEntry(TEAM, "u", scout, "ftc");
    expect(h.saveScout).toHaveBeenCalledTimes(1);
  });
});

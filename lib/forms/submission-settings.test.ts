import { describe, expect, it } from "vitest";
import {
  isSubmissionOpen,
  MASTER_OFF_MESSAGE,
  OPEN_SUBMISSION_SETTINGS,
  readFormSubmissionSettings,
  seasonOffMessage,
  settingsForWrite,
  submissionBlock,
  SubmissionClosedError,
  withSubmissionChange,
} from "@/lib/forms/submission-settings";

const actor = { uid: "u1", name: "Ada" };

describe("reading the settings", () => {
  it("a missing field means everything is on, so nothing changes on deploy", () => {
    for (const raw of [undefined, null, {}, [], "off", 0, { enabled: "no" }, { seasons: "all" }, { seasons: [false] }]) {
      const s = readFormSubmissionSettings(raw);
      expect(s.enabled).toBe(true);
      expect(isSubmissionOpen(s, "rebuilt")).toBe(true);
      expect(isSubmissionOpen(s, "reefscape")).toBe(true);
      expect(isSubmissionOpen(s, null)).toBe(true);
    }
    expect(readFormSubmissionSettings(undefined)).toBe(OPEN_SUBMISSION_SETTINGS);
    expect(submissionBlock(undefined, "rebuilt")).toBeNull();
    expect(submissionBlock(null, "rebuilt")).toBeNull();
  });

  it("only an explicit false closes anything", () => {
    const s = readFormSubmissionSettings({ enabled: true, seasons: { rebuilt: true, reefscape: "false", charged_up: null } });
    expect(s.seasons).toEqual({});
    expect(isSubmissionOpen(s, "reefscape")).toBe(true);
  });

  it("reads who changed it and when", () => {
    const s = readFormSubmissionSettings({ enabled: false, seasons: {}, updatedBy: { uid: "u1", name: "Ada" }, updatedAtMs: 1700000000000 });
    expect(s).toMatchObject({ enabled: false, updatedBy: { uid: "u1", name: "Ada" }, updatedAtMs: 1700000000000 });
    expect(readFormSubmissionSettings({ updatedBy: { name: "no uid" }, updatedAtMs: "soon" })).toEqual({ enabled: true, seasons: {} });
  });
});

describe("master off", () => {
  const s = readFormSubmissionSettings({ enabled: false });
  it("closes every season, and a form with no season", () => {
    for (const id of ["rebuilt", "reefscape", "charged_up", "solo", null, undefined]) expect(isSubmissionOpen(s, id)).toBe(false);
  });
  it("says so", () => {
    expect(submissionBlock(s, "rebuilt", "REBUILT")).toEqual({ kind: "all", message: MASTER_OFF_MESSAGE });
  });
});

describe("one season off", () => {
  const s = readFormSubmissionSettings({ enabled: true, seasons: { reefscape: false } });
  it("closes that season only: the other seasons are unaffected", () => {
    expect(isSubmissionOpen(s, "reefscape")).toBe(false);
    expect(isSubmissionOpen(s, "rebuilt")).toBe(true);
    expect(isSubmissionOpen(s, "charged_up")).toBe(true);
    expect(isSubmissionOpen(s, "solo")).toBe(true);
    expect(isSubmissionOpen(s, null)).toBe(true);
  });
  it("names the game in the message", () => {
    expect(submissionBlock(s, "reefscape", "REEFSCAPE")).toEqual({ kind: "season", message: "Submissions for REEFSCAPE are turned off by your team admin" });
    expect(submissionBlock(s, "reefscape")?.message).toBe(seasonOffMessage("reefscape"));
    expect(submissionBlock(s, "rebuilt", "REBUILT")).toBeNull();
  });
  it("the master switch wins over an open season", () => {
    expect(submissionBlock(readFormSubmissionSettings({ enabled: false, seasons: { rebuilt: true } }), "rebuilt")?.kind).toBe("all");
  });
});

describe("changing the settings", () => {
  it("flips the master switch and records who and when, without touching the seasons", () => {
    const next = withSubmissionChange(readFormSubmissionSettings({ seasons: { reefscape: false } }), { enabled: false }, actor, 5);
    expect(next).toEqual({ enabled: false, seasons: { reefscape: false }, updatedBy: actor, updatedAtMs: 5 });
  });
  it("flips one season, keeping the others", () => {
    const base = readFormSubmissionSettings({ seasons: { reefscape: false } });
    expect(withSubmissionChange(base, { seasonId: "rebuilt", open: false }, actor, 6).seasons).toEqual({ reefscape: false, rebuilt: false });
    expect(withSubmissionChange(base, { seasonId: "reefscape", open: true }, actor, 6).seasons).toEqual({ reefscape: true });
  });
  it("writes every season of the program explicitly, so a merge write replaces an old false", () => {
    const previous = readFormSubmissionSettings({ seasons: { reefscape: false } });
    const next = withSubmissionChange(previous, { seasonId: "reefscape", open: true }, actor, 7);
    const written = settingsForWrite(next, previous, ["rebuilt", "reefscape", "charged_up"]);
    expect(written.seasons).toEqual({ rebuilt: true, reefscape: true, charged_up: true });
    expect(readFormSubmissionSettings(written).seasons).toEqual({});
  });
  it("does not change its input", () => {
    const base = readFormSubmissionSettings({ seasons: { reefscape: false } });
    withSubmissionChange(base, { seasonId: "rebuilt", open: false }, actor, 1);
    expect(base.seasons).toEqual({ reefscape: false });
  });
});

describe("SubmissionClosedError", () => {
  it("carries the message the form shows", () => {
    const error = new SubmissionClosedError({ kind: "season", message: seasonOffMessage("REEFSCAPE") });
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("Submissions for REEFSCAPE are turned off by your team admin");
    expect(error.block.kind).toBe("season");
  });
});

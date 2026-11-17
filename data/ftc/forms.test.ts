import { describe, expect, it } from "vitest";
import { formIdFromDocId, ftcDocsToFormDocs, ftcDocToFormDoc, ftcDocToFormVersion, type FtcFormDocBody } from "@/data/ftc/forms";
import { formDocId } from "@/lib/forms/resolve";

const form = { id: "pit-scout", name: "Pit Scout", formType: "pit-scout", sections: [] };

const stored = (over: FtcFormDocBody = {}): FtcFormDocBody => ({
  teamId: "team1",
  formId: "pit-scout",
  name: "Pit Scout",
  origin: "built-in-override",
  baseBuiltInId: "pit-scout",
  baseBuiltInHash: "abc123",
  publishedVersion: 3,
  draft: form,
  active: true,
  archived: false,
  createdBy: "uid-ada",
  createdAt: 1000,
  updatedAt: { toMillis: () => 2000 },
  updatedBy: "uid-grace",
  ...over,
});

describe("ftcDocToFormDoc", () => {
  it("maps a stored form doc", () => {
    expect(ftcDocToFormDoc("team1_pit-scout", stored())).toEqual({
      teamId: "team1",
      formId: "pit-scout",
      name: "Pit Scout",
      origin: "built-in-override",
      baseBuiltInId: "pit-scout",
      baseBuiltInHash: "abc123",
      publishedVersion: 3,
      draft: form,
      active: true,
      archived: false,
      createdBy: "uid-ada",
      createdAt: 1000,
      updatedAt: 2000,
      updatedBy: "uid-grace",
    });
  });

  it("a sparse doc takes its team and form ids from its own id", () => {
    const doc = ftcDocToFormDoc(formDocId("team1", "my_form"), {});
    expect(doc).toEqual({ teamId: "team1", formId: "my_form", name: "", origin: "custom", publishedVersion: null, draft: null, active: true, archived: false, createdBy: "" });
  });

  it("only an explicit false turns a form off; an unknown origin reads as custom", () => {
    expect(ftcDocToFormDoc("t_f", stored({ active: false })).active).toBe(false);
    expect(ftcDocToFormDoc("t_f", stored({ active: undefined })).active).toBe(true);
    expect(ftcDocToFormDoc("t_f", stored({ origin: "built-in" })).origin).toBe("custom");
    expect(ftcDocToFormDoc("t_f", stored({ origin: "template" })).origin).toBe("template");
  });

  it("an unpublished form has no version; a draft must be a map", () => {
    expect(ftcDocToFormDoc("t_f", stored({ publishedVersion: null, draft: null })).publishedVersion).toBeNull();
    expect(ftcDocToFormDoc("t_f", stored({ publishedVersion: 0 })).publishedVersion).toBeNull();
    expect(ftcDocToFormDoc("t_f", stored({ publishedVersion: "3" })).publishedVersion).toBeNull();
    expect(ftcDocToFormDoc("t_f", stored({ draft: "x" })).draft).toBeNull();
  });
});

describe("formIdFromDocId", () => {
  it("is everything after the first underscore", () => {
    expect(formIdFromDocId("team1_pit-scout")).toBe("pit-scout");
    expect(formIdFromDocId("team1_my_form_2")).toBe("my_form_2");
    expect(formIdFromDocId("plain")).toBe("plain");
  });
});

describe("ftcDocsToFormDocs", () => {
  it("keys the docs by form id and skips bodies that are not maps", () => {
    const docs = ftcDocsToFormDocs([
      { id: "team1_pit-scout", data: stored() },
      { id: "team1_bad", data: null },
      { id: "team1_other", data: stored({ formId: "other", name: "Other" }) },
    ]);
    expect([...docs.keys()]).toEqual(["pit-scout", "other"]);
    expect(docs.get("other")?.name).toBe("Other");
  });
});

describe("ftcDocToFormVersion", () => {
  it("maps a published version", () => {
    expect(ftcDocToFormVersion("team1_pit-scout", { teamId: "team1", formId: "pit-scout", version: 3, form, note: "added photos", createdBy: "uid-ada", createdAt: 5 })).toEqual({
      teamId: "team1",
      formId: "pit-scout",
      version: 3,
      form,
      note: "added photos",
      createdBy: "uid-ada",
      createdAt: 5,
    });
  });

  it("takes missing ids from the doc id and leaves out an empty note", () => {
    expect(ftcDocToFormVersion("team1_pit-scout", { version: 1, form })).toEqual({ teamId: "team1", formId: "pit-scout", version: 1, form, createdBy: "" });
  });

  it("is null without a usable form or version number", () => {
    expect(ftcDocToFormVersion("t_f", { version: 1 })).toBeNull();
    expect(ftcDocToFormVersion("t_f", { version: 1, form: "x" })).toBeNull();
    expect(ftcDocToFormVersion("t_f", { version: 0, form })).toBeNull();
    expect(ftcDocToFormVersion("t_f", { form })).toBeNull();
  });
});

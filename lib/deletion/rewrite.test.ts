import { describe, expect, it } from "vitest";
import { DELETED_ACCOUNT_NAME } from "@/lib/deletion/constants";
import { PERSON_DATA_REGISTRY } from "@/lib/deletion/registry";
import { rewriteDocument, rewriteNameOnly } from "@/lib/deletion/rewrite";
import { renameImportedRowId } from "@/lib/ftc/deletion-entries";

const UID = "real-uid-123";
const OP = "deleted-0123456789abcdef0123456789abcdef";
const entry = (id: string) => [...PERSON_DATA_REGISTRY.frc, ...PERSON_DATA_REGISTRY.ftc].find((e) => e.id === id)!;
const run = (id: string, data: Record<string, unknown>, docId = "d1", knownMatch = false) => rewriteDocument({ id: docId, data, uid: UID, opaque: OP, spec: entry(id).rewrite!, knownMatch });
const apply = (data: Record<string, unknown>, patch: ReturnType<typeof run>) => {
  const out = { ...data, ...(patch?.set ?? {}) };
  for (const f of patch?.deleteFields ?? []) delete out[f];
  return out;
};

describe("rewriteDocument", () => {
  it("rewrites a uid and the name that belongs to it, and nothing else", () => {
    const data = { scoutId: UID, scoutName: "Ada", teamNumber: 254, score: { total: 9 } };
    const patch = run("scouting", data);
    expect(patch?.set).toEqual({ scoutId: OP, scoutName: DELETED_ACCOUNT_NAME });
    expect(patch?.deleteFields).toEqual([]);
  });

  it("is idempotent: its own output yields null", () => {
    const data = { scoutId: UID, scoutName: "Ada" };
    expect(run("scouting", apply(data, run("scouting", data)))).toBeNull();
  });

  it("leaves another person's row alone", () => {
    expect(run("scouting", { scoutId: "someone-else", scoutName: "Bo" })).toBeNull();
  });

  it("does not add a name field the row never had", () => {
    expect(run("scouting", { scoutId: UID })?.set).toEqual({ scoutId: OP });
  });

  it("rewrites the actor and the target of an audit row independently", () => {
    const data = { uid: "admin", actorName: "Admin", target: { targetUid: UID, targetName: "Ada", note: "x" } };
    const patch = run("auditLog", data);
    expect(patch?.set).toEqual({ target: { targetUid: OP, targetName: DELETED_ACCOUNT_NAME, note: "x" } });
  });

  it("replaces a uid inside attendance lists once, without a duplicate", () => {
    expect(run("eventAttendance", { uids: ["a", UID, "b"] })?.set).toEqual({ uids: ["a", OP, "b"] });
    expect(run("eventAttendance", { uids: [UID, OP] })?.set).toEqual({ uids: [OP] });
  });

  it("rewrites eventAttendees, embedded judge cards and an owner field of a team document", () => {
    const data = {
      ownerUid: UID,
      verifiedOwnerId: UID,
      eventAttendees: { "2026wabon": ["x", UID], "2026other": ["y"] },
      judgeBookCards: [{ createdByUid: UID, createdByName: "Ada", updatedByUid: "z", updatedByName: "Zed" }, { createdByUid: "q", createdByName: "Q" }],
    };
    const patch = run("teams", data);
    expect(patch?.set.ownerUid).toBe(OP);
    expect(patch?.set.verifiedOwnerId).toBe(OP);
    expect(patch?.set.eventAttendees).toEqual({ "2026wabon": ["x", OP], "2026other": ["y"] });
    expect(patch?.set.judgeBookCards).toEqual([{ createdByUid: OP, createdByName: DELETED_ACCOUNT_NAME, updatedByUid: "z", updatedByName: "Zed" }, { createdByUid: "q", createdByName: "Q" }]);
    expect(run("teams", apply(data, patch))).toBeNull();
  });

  it("rewrites an FTC assignment document: generatedBy, scoutUids, the counts key and the slots", () => {
    const version = { generatedBy: UID, settings: { scoutUids: [UID, "b"] }, counts: { [UID]: 3, b: 1 }, slots: [{ scoutUid: UID, slot: "red1" }, { scoutUid: "b", slot: "red2" }] };
    const data = { teamId: "t", current: version, previous: null };
    const patch = run("assignments", data);
    const current = patch?.set.current as typeof version;
    expect(current.generatedBy).toBe(OP);
    expect(current.settings.scoutUids).toEqual([OP, "b"]);
    expect(current.counts).toEqual({ b: 1, [OP]: 3 });
    expect(current.slots.map((s) => s.scoutUid)).toEqual([OP, "b"]);
    expect(run("assignments", apply(data, patch))).toBeNull();
  });

  it("rewrites a lobby's host and pairing (uid array and the robot map key)", () => {
    const data = { hostUid: UID, hostName: "Ada", pairing: [{ pairId: "p", playerUids: [UID, "b"], robotForUid: { [UID]: 1, b: 2 } }] };
    const patch = run("lobbies", data);
    expect(patch?.set.hostUid).toBe(OP);
    expect(patch?.set.hostName).toBe(DELETED_ACCOUNT_NAME);
    expect((patch?.set.pairing as { playerUids: string[] }[])[0].playerUids).toEqual([OP, "b"]);
  });

  describe("application documents", () => {
    const app = { applicantUid: UID, applicantName: "Ada", applicantEmail: "ada@example.org", emailKey: "abc", decidedBy: "owner", status: "approved", teamNumber: "254" };
    it("an applicant's name, email and email key go; status and team number stay", () => {
      const out = apply(app, run("teamApplications", app));
      expect(out).toEqual({ applicantUid: OP, decidedBy: "owner", status: "approved", teamNumber: "254" });
    });
    it("a document this person only DECIDED keeps the other person's name and email", () => {
      const decided = { ...app, applicantUid: "other", decidedBy: UID };
      const patch = run("teamApplications", decided);
      expect(patch?.set).toEqual({ decidedBy: OP });
      expect(patch?.deleteFields).toEqual([]);
    });
    it("a block found by the person's email loses its value and keeps the rest", () => {
      const block = { type: "email", value: "ada@example.org", reason: "abuse", createdBy: "owner" };
      const patch = run("applicationBlocks", block, "email_abc", true);
      expect(patch).toEqual({ set: {}, deleteFields: ["value"] });
      expect(run("applicationBlocks", apply(block, patch), "email_abc", true)).toBeNull();
    });
  });

  it("an imported row keeps its scout's name when the uid is only the importer's", () => {
    const csv = { uid: UID, scoutName: "Other Scout" };
    expect(run("scoutEntries", csv, "csv_t_e_q1_100_other-scout-abc")?.set).toEqual({ uid: OP });
  });

  it("rewriteNameOnly sets the name once", () => {
    expect(rewriteNameOnly({ scoutName: "Ada" }, "scoutName")?.set).toEqual({ scoutName: DELETED_ACCOUNT_NAME });
    expect(rewriteNameOnly({ scoutName: DELETED_ACCOUNT_NAME }, "scoutName")).toBeNull();
    expect(rewriteNameOnly({}, "scoutName")).toBeNull();
  });
});

describe("renameImportedRowId", () => {
  it("swaps the name slug of an imported row id for the replacement name's", () => {
    expect(renameImportedRowId("csv_t1_2026wabon_q1_100_ada-lovelace-1x2y", "Ada Lovelace")).toBe("csv_t1_2026wabon_q1_100_deleted-account-1x2y");
  });
  it("leaves any other id alone", () => {
    expect(renameImportedRowId("abc123", "Ada")).toBeNull();
    expect(renameImportedRowId("csv_t1_e_q1_100_bob-9", "Ada")).toBeNull();
  });
});

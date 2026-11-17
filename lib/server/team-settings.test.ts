import { beforeEach, describe, expect, it } from "vitest";
import { FakeFirestore } from "@/lib/server/test-support/fake-firestore";
import { getAdminsSeeAllProfiles, getAvatarUploadsEnabled, getTeamCreationEnabled, getTeamCreationEnabledInTransaction } from "@/lib/server/team-settings";

// Beta release defaults for appSettings/global when a field (or the whole document) is missing:
//   teamCreationEnabled  -> OFF, and reading it never writes anything
//   avatarUploadsEnabled -> OFF (uploads only when explicitly true)
//   adminsSeeAllProfiles -> ON (owner's decision; only an explicit false turns it off)
let fake: FakeFirestore;
const db = () => fake.asFirestore();
beforeEach(() => {
  fake = new FakeFirestore();
});

describe("appSettings/global defaults", () => {
  it("a missing document: creation off, uploads off, admins see profiles on, and nothing is written", async () => {
    expect(await getTeamCreationEnabled(db())).toBe(false);
    expect(await getAvatarUploadsEnabled(db())).toBe(false);
    expect(await getAdminsSeeAllProfiles(db())).toBe(true);
    await db().runTransaction(async (txn) => {
      expect(await getTeamCreationEnabledInTransaction(db(), txn)).toBe(false);
    });
    expect(fake.read("appSettings/global")).toBeUndefined();
  });

  it("a missing document is not written even when teams already exist, or none do", async () => {
    await getTeamCreationEnabled(db());
    fake.seed("teams/ABC123", { teamName: "Alpha" });
    await getTeamCreationEnabled(db());
    expect(fake.read("appSettings/global")).toBeUndefined();
  });

  it("a document without the fields behaves the same and is left untouched", async () => {
    fake.seed("appSettings/global", { other: 1 });
    expect(await getTeamCreationEnabled(db())).toBe(false);
    expect(await getAvatarUploadsEnabled(db())).toBe(false);
    expect(await getAdminsSeeAllProfiles(db())).toBe(true);
    expect(fake.read("appSettings/global")).toEqual({ other: 1 });
  });

  it("creation and uploads are on only for an explicit true; anything else is off", async () => {
    fake.seed("appSettings/global", { teamCreationEnabled: true, avatarUploadsEnabled: true });
    expect(await getTeamCreationEnabled(db())).toBe(true);
    expect(await getAvatarUploadsEnabled(db())).toBe(true);
    await db().runTransaction(async (txn) => {
      expect(await getTeamCreationEnabledInTransaction(db(), txn)).toBe(true);
    });
    for (const odd of ["true", 1, null, {}]) {
      fake.seed("appSettings/global", { teamCreationEnabled: odd, avatarUploadsEnabled: odd });
      expect(await getTeamCreationEnabled(db())).toBe(false);
      expect(await getAvatarUploadsEnabled(db())).toBe(false);
    }
  });

  it("admins see profiles stays on unless explicitly false", async () => {
    fake.seed("appSettings/global", { adminsSeeAllProfiles: false });
    expect(await getAdminsSeeAllProfiles(db())).toBe(false);
    fake.seed("appSettings/global", { adminsSeeAllProfiles: true });
    expect(await getAdminsSeeAllProfiles(db())).toBe(true);
  });
});

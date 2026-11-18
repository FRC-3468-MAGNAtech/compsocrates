import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_RUN_WRITES, MAX_RUN_WRITES } from "@/lib/deletion/constants";
import { FakeFirestore } from "@/lib/server/test-support/fake-firestore";
import { getAccountDeletionEnabled, getAccountDeletionSettings, parseRunBudget, resetAccountDeletionSettingsCache } from "@/lib/server/team-settings";

beforeEach(() => resetAccountDeletionSettingsCache());

describe("accountDeletionRunBudget", () => {
  it("missing, not a positive integer, or not a number means the default", () => {
    for (const v of [undefined, null, 0, -5, 1.5, "5000", NaN, Infinity, {}]) expect(parseRunBudget(v)).toBe(DEFAULT_RUN_WRITES);
  });
  it("a positive integer is taken, capped at the maximum", () => {
    expect(parseRunBudget(100)).toBe(100);
    expect(parseRunBudget(MAX_RUN_WRITES)).toBe(MAX_RUN_WRITES);
    expect(parseRunBudget(50_000)).toBe(MAX_RUN_WRITES);
  });
});

describe("accountDeletionEnabled (the kill switch)", () => {
  it("is OFF when the document or the field is missing, and only an explicit true turns it ON", async () => {
    const empty = new FakeFirestore();
    expect(await getAccountDeletionEnabled(empty.asFirestore())).toBe(false);
    resetAccountDeletionSettingsCache();
    expect(await getAccountDeletionEnabled(new FakeFirestore().seed("appSettings/global", { membershipsEnabled: true }).asFirestore())).toBe(false);
    resetAccountDeletionSettingsCache();
    for (const v of ["true", 1, "yes"]) {
      expect(await getAccountDeletionEnabled(new FakeFirestore().seed("appSettings/global", { accountDeletionEnabled: v }).asFirestore())).toBe(false);
      resetAccountDeletionSettingsCache();
    }
    expect(await getAccountDeletionEnabled(new FakeFirestore().seed("appSettings/global", { accountDeletionEnabled: true }).asFirestore())).toBe(true);
  });

  it("is read once per ~30 seconds, the budget with it", async () => {
    const fake = new FakeFirestore().seed("appSettings/global", { accountDeletionEnabled: true, accountDeletionRunBudget: 500 });
    const db = fake.asFirestore();
    expect(await getAccountDeletionSettings(db, 1000)).toEqual({ enabled: true, runWrites: 500 });
    fake.seed("appSettings/global", { accountDeletionEnabled: false });
    expect((await getAccountDeletionSettings(db, 10_000)).enabled).toBe(true);
    expect(await getAccountDeletionSettings(db, 40_000)).toEqual({ enabled: false, runWrites: DEFAULT_RUN_WRITES });
  });
});

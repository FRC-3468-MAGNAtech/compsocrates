import { describe, expect, it } from "vitest";
import { destinationData, destinationPath, remapIds } from "./migration";

const map = new Map([["oldUid", "newUid"]]);

describe("destinationPath", () => {
  it("namespaces migrated collections and rewrites account ids in the path", () => {
    expect(destinationPath("teams/t1", new Map())).toBe("programs/ftc/teams/t1");
    expect(destinationPath("users/oldUid", map)).toBe("programs/ftc/users/newUid");
    expect(destinationPath("liveMatches/m1/scouts/oldUid", map)).toBe("programs/ftc/liveMatches/m1/scouts/newUid");
  });
  it("skips platform state and unknown collections", () => {
    expect(destinationPath("appSettings/x", map)).toBeNull();
    expect(destinationPath("rateLimits/x", map)).toBeNull();
    expect(destinationPath("somethingElse/x", map)).toBeNull();
  });
});

describe("remapIds", () => {
  it("replaces exact id strings anywhere, and nothing else", () => {
    const out = remapIds({ uid: "oldUid", name: "oldUid is a name", list: ["oldUid", "x"], deep: { owner: "oldUid" }, n: 3 }, map);
    expect(out).toEqual({ uid: "newUid", name: "oldUid is a name", list: ["newUid", "x"], deep: { owner: "newUid" }, n: 3 });
  });
  it("returns non-plain objects untouched", () => {
    const stamp = new Date(0);
    expect(remapIds({ at: stamp }, map).at).toBe(stamp);
  });
  it("does nothing with an empty map", () => {
    const v = { uid: "oldUid" };
    expect(remapIds(v, new Map())).toBe(v);
  });
});

describe("destinationData", () => {
  it("marks provenance", () => {
    expect(destinationData({ uid: "oldUid" }, map)).toEqual({ uid: "newUid", migratedFrom: "ce" });
  });
});

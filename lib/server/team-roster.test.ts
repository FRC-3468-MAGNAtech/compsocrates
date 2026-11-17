import { beforeEach, describe, expect, it } from "vitest";
import { FakeFirestore } from "@/lib/server/test-support/fake-firestore";
import { readPointerRoster, readServerRoster } from "@/lib/server/team-roster";
import { resetMembershipsEnabledCache } from "@/lib/server/team-settings";

let fake: FakeFirestore;
const db = () => fake.asFirestore();
const mem = (teamId: string, uid: string, over: Record<string, unknown> = {}) => ({ uid, teamId, role: "match-scout", roles: null, secondaryRoles: [], isAdmin: false, isOwner: false, fieldTeamIds: null, name: "P", status: "active", origin: "pointer", joinedAt: 1, leftAt: null, endedBy: null, updatedAt: 1, ...over });

/** Records the collection of every `where(...)` query the code under test starts. */
function countQueries(f: FakeFirestore): string[] {
  const seen: string[] = [];
  const real = f.collection.bind(f);
  f.collection = ((name: string) => {
    const c = real(name);
    const where = c.where;
    c.where = ((...args: Parameters<typeof where>) => {
      seen.push(name);
      return where(...args);
    }) as typeof where;
    return c;
  }) as typeof f.collection;
  return seen;
}

beforeEach(() => {
  fake = new FakeFirestore();
  resetMembershipsEnabledCache();
  fake.seed("users/u1", { teamId: "T1", displayName: "Ann" });
  fake.seed("users/u2", { teamId: "T1", displayName: "Bo" });
  fake.seed("memberships/T1_u2", mem("T1", "u2", { name: "Stale Bo" }));
  fake.seed("memberships/T1_u3", mem("T1", "u3", { name: "Cy" }));
  fake.seed("memberships/T1_u4", mem("T1", "u4", { status: "past" }));
  fake.seed("programs/ftc/users/f1", { teamId: "T1", name: "Fay" });
  fake.seed("programs/ftc/memberships/T1_f2", mem("T1", "f2", { name: "Gus" }));
});

describe("the roster seam (server side)", () => {
  it("OFF: exactly the one `users where teamId ==` query the readers always ran, and nothing else", async () => {
    fake.seed("appSettings/global", { membershipsEnabled: false });
    const queries = countQueries(fake);
    const rows = await readServerRoster(db(), "frc", "T1");
    expect(queries).toEqual(["users"]);
    expect(rows.map((r) => r.uid).sort()).toEqual(["u1", "u2"]);
    expect(rows.every((r) => r.source === "user")).toBe(true);
  });

  it("missing setting or an unreadable one counts as OFF", async () => {
    const queries = countQueries(fake);
    expect((await readServerRoster(db(), "frc", "T1")).length).toBe(2);
    expect(queries).toEqual(["users"]);
  });

  it("ON: the same users query plus the team's ACTIVE memberships, a person already found through their user document is not repeated", async () => {
    fake.seed("appSettings/global", { membershipsEnabled: true });
    const queries = countQueries(fake);
    const rows = await readServerRoster(db(), "frc", "T1");
    expect(queries).toEqual(["users", "memberships"]);
    expect(rows.map((r) => `${r.uid}:${r.source}`).sort()).toEqual(["u1:user", "u2:user", "u3:membership"]);
    expect(rows.find((r) => r.uid === "u2")?.data.displayName).toBe("Bo");
  });

  it("works the same for the other program's paths, and the pointer-only read is that one users query", async () => {
    fake.seed("appSettings/global", { membershipsEnabled: true });
    const rows = await readServerRoster(db(), "ftc", "T1");
    expect(rows.map((r) => `${r.uid}:${r.source}`).sort()).toEqual(["f1:user", "f2:membership"]);
    expect((await readPointerRoster(db(), "ftc", "T1")).map((r) => r.uid)).toEqual(["f1"]);
  });
});

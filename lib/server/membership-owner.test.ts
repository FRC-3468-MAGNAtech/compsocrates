import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_PROGRAM } from "@/config/programs/types";
import { FakeFirestore } from "@/lib/server/test-support/fake-firestore";
import { readCreationState, readOwnerTransferState, writeCreatorMembership, writeOwnerTransfer } from "@/lib/server/membership-flows";
import type { Transaction } from "firebase-admin/firestore";

// The verified-membership halves the existing team-creation, application-approval and ownership-transfer transactions call (root program).
const NOW = 1_700_000_000_000;
const P = DEFAULT_PROGRAM;
let fake: FakeFirestore;
const db = () => fake.asFirestore();
const mem = (teamId: string, uid: string, over: Record<string, unknown> = {}) => ({ uid, teamId, role: "match-scout", roles: ["match-scout"], secondaryRoles: [], isAdmin: false, isOwner: false, fieldTeamIds: null, name: "P", status: "active", origin: "pointer", joinedAt: 1, leftAt: null, endedBy: null, updatedAt: 1, ...over });

beforeEach(() => {
  fake = new FakeFirestore();
});

describe("team creation and application approval", () => {
  it("makes the creator's membership verified, admin and owner, in the same transaction as the writes around it", async () => {
    await db().runTransaction(async (txn) => {
      const created = await readCreationState(db(), txn as unknown as Transaction, P, "NEWTEAM", "u1");
      (txn as unknown as Transaction).set(db().collection("teams").doc("NEWTEAM"), { teamName: "N" });
      writeCreatorMembership(txn as unknown as Transaction, P, created, { uid: "u1", teamId: "NEWTEAM", name: "Ann", role: "lead-scout", nowMs: NOW });
    });
    expect(fake.read("teams/NEWTEAM")).toBeDefined();
    expect(fake.read("memberships/NEWTEAM_u1")).toMatchObject({ origin: "verified", isAdmin: true, isOwner: true, status: "active", role: "lead-scout", name: "Ann", joinedAt: NOW });
  });

  it("refuses at five active teams, and the transaction changes nothing", async () => {
    for (const t of ["A1", "B1", "C1", "D1", "E1"]) fake.seed(`memberships/${t}_u1`, mem(t, "u1"));
    await expect(
      db().runTransaction(async (txn) => {
        const created = await readCreationState(db(), txn as unknown as Transaction, P, "NEWTEAM", "u1");
        (txn as unknown as Transaction).set(db().collection("teams").doc("NEWTEAM"), { teamName: "N" });
        writeCreatorMembership(txn as unknown as Transaction, P, created, { uid: "u1", teamId: "NEWTEAM", name: "Ann", role: "match-scout", nowMs: NOW });
      })
    ).rejects.toMatchObject({ status: 409, code: "membership_limit" });
    expect(fake.read("teams/NEWTEAM")).toBeUndefined();
  });
});

describe("ownership transfer", () => {
  const run = (newUid: string, oldUid: string | null, newUser: Record<string, unknown> | undefined) =>
    db().runTransaction(async (txn) => {
      const state = await readOwnerTransferState(db(), txn as unknown as Transaction, P, "TEAMA1", newUid, oldUid);
      writeOwnerTransfer(txn as unknown as Transaction, P, state, { teamId: "TEAMA1", newUid, newUser, nowMs: NOW });
    });

  it("upgrades the new owner's membership in place and takes only the owner flag from the old owner's", async () => {
    fake.seed("memberships/TEAMA1_new", mem("TEAMA1", "new", { isAdmin: true }));
    fake.seed("memberships/TEAMA1_old", mem("TEAMA1", "old", { isAdmin: true, isOwner: true, origin: "verified" }));
    await run("new", "old", { teamId: "TEAMA1" });
    expect(fake.read("memberships/TEAMA1_new")).toMatchObject({ origin: "verified", isAdmin: true, isOwner: true, joinedAt: 1 });
    expect(fake.read("memberships/TEAMA1_old")).toMatchObject({ isOwner: false, isAdmin: true, origin: "verified" });
  });

  it("creates a verified owner membership for a new owner who has none yet, from their user document", async () => {
    await run("new", "old", { displayName: "Nia", teamId: "TEAMA1", role: "pit-scout", roles: ["pit-scout"], secondaryRoles: [], isTeamAdmin: true });
    expect(fake.read("memberships/TEAMA1_new")).toMatchObject({ uid: "new", origin: "verified", isOwner: true, isAdmin: true, role: "pit-scout", name: "Nia" });
    expect(fake.read("memberships/TEAMA1_old")).toBeUndefined();
  });
});

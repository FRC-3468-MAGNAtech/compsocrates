import { describe, expect, it } from "vitest";
import type { ScheduleSlot } from "@/lib/scheduler/types";
import {
  activeRequestFor,
  buildSubInRequest,
  canCancel,
  cancelPatch,
  checkCanClaim,
  checkCanRequest,
  claimableFor,
  claimedAssignments,
  claimPatch,
  effectiveStatus,
  marksForMatch,
  parseRange,
  parseSubInRequest,
  slotsInRange,
  SUB_IN_TTL_MS,
  subInMatchKey,
  subInMatchLabel,
  visibleRequests,
  type SubInRequest,
} from "@/lib/sub-ins/model";

const T0 = 1_790_000_000_000;
const alice = { uid: "alice", name: "Alice" };
const bob = { uid: "bob", name: "Bob" };

const make = (over: Partial<SubInRequest> = {}): SubInRequest => ({
  id: "r1",
  ...buildSubInRequest({ teamId: "T", eventKey: "2026arli", actor: alice, target: { matchType: "Qualification", matchNumber: 12, teamNumber: 254 }, now: T0 }),
  ...over,
});

describe("keys and labels", () => {
  it("uses app match keys and CS-style labels", () => {
    expect(subInMatchKey("Qualification", 12)).toBe("Q12");
    expect(subInMatchKey("Practice", 3)).toBe("P3");
    expect(subInMatchKey("Playoff", 7)).toBe("F7");
    expect(subInMatchLabel("Playoff", 7)).toBe("Finals 7");
  });
});

describe("buildSubInRequest", () => {
  it("writes an open request that expires in 6 hours", () => {
    const r = make();
    expect(r).toMatchObject({ status: "open", matchKey: "Q12", matchLabel: "Qualification 12", teamNumber: 254, requestedById: "alice", requestedByName: "Alice", requestedAt: T0, claimedById: null, claimedAt: null });
    expect(r.expiresAt - r.requestedAt).toBe(SUB_IN_TTL_MS);
    expect(SUB_IN_TTL_MS).toBe(21_600_000);
  });
  it("names a nameless actor Scout, as CS does", () => {
    expect(buildSubInRequest({ teamId: "T", eventKey: "e", actor: { uid: "u", name: "" }, target: { matchType: "Practice", matchNumber: 1, teamNumber: 1 }, now: 1 }).requestedByName).toBe("Scout");
  });
});

describe("parseSubInRequest", () => {
  it("reads a doc and tolerates gaps", () => {
    const parsed = parseSubInRequest("x", { teamId: "T", eventKey: "e", matchKey: "Q1", teamNumber: 9, requestedAt: 100, status: "weird", extra: 1 });
    expect(parsed.status).toBe("open");
    expect(parsed.expiresAt).toBe(100 + SUB_IN_TTL_MS);
    expect(parsed.claimedById).toBeNull();
    expect(parsed.requestedByName).toBe("");
  });
  it("round-trips a built request", () => {
    const built = make();
    const { id, ...data } = built;
    expect(parseSubInRequest(id, data)).toEqual(built);
  });
});

describe("expiry", () => {
  it("an open request expires at expiresAt, a claimed one never does", () => {
    const open = make();
    expect(effectiveStatus(open, T0 + SUB_IN_TTL_MS - 1)).toBe("open");
    expect(effectiveStatus(open, T0 + SUB_IN_TTL_MS)).toBe("expired");
    const claimed = make({ ...claimPatch(bob, T0 + 1) });
    expect(effectiveStatus(claimed, T0 + SUB_IN_TTL_MS * 5)).toBe("claimed");
    expect(effectiveStatus(make({ status: "cancelled" }), T0)).toBe("cancelled");
  });
});

describe("requesting", () => {
  const target = { matchType: "Qualification" as const, matchNumber: 12, teamNumber: 254 };
  it("refuses a second request for the same robot and match", () => {
    expect(checkCanRequest([], "2026arli", target, T0)).toEqual({ ok: true });
    expect(checkCanRequest([make()], "2026arli", target, T0 + 1)).toEqual({ ok: false, reason: "A sub-in has already been requested for this team." });
  });
  it("says assigned when it was taken", () => {
    expect(checkCanRequest([make(claimPatch(bob, T0))], "2026arli", target, T0 + 1)).toEqual({ ok: false, reason: "A sub-in has already been assigned for this team." });
  });
  it("allows again after expiry or cancel, another team, another match or another event", () => {
    expect(checkCanRequest([make()], "2026arli", target, T0 + SUB_IN_TTL_MS).ok).toBe(true);
    expect(checkCanRequest([make({ status: "cancelled" })], "2026arli", target, T0).ok).toBe(true);
    expect(checkCanRequest([make()], "2026arli", { ...target, teamNumber: 1 }, T0).ok).toBe(true);
    expect(checkCanRequest([make()], "2026arli", { ...target, matchNumber: 13 }, T0).ok).toBe(true);
    expect(checkCanRequest([make()], "2026lake", target, T0).ok).toBe(true);
  });
  it("activeRequestFor ignores other slots", () => {
    expect(activeRequestFor([make()], "2026arli", "Q12", 254, T0)?.id).toBe("r1");
    expect(activeRequestFor([make()], "2026arli", "Q12", 999, T0)).toBeNull();
  });
});

describe("range", () => {
  const slot = (matchType: ScheduleSlot["matchType"], matchNumber: number, scoutUid: string | null, teamNumber = 100 + matchNumber): ScheduleSlot => ({ matchType, matchNumber, slot: "red1", teamNumber, scoutUid });
  const slots = [slot("Qualification", 44, "alice"), slot("Qualification", 45, "alice"), slot("Qualification", 50, "bob"), slot("Qualification", 60, "alice"), slot("Qualification", 66, "alice"), slot("Practice", 50, "alice"), slot("Qualification", 60, "alice", 999)];
  it("keeps only my slots of that type inside the inclusive range, in order, one per match", () => {
    expect(slotsInRange(slots, "alice", "Qualification", 45, 65).map((s) => s.matchNumber)).toEqual([45, 60]);
  });
  it("accepts the range in either order", () => {
    expect(slotsInRange(slots, "alice", "Qualification", 65, 45).map((s) => s.matchNumber)).toEqual([45, 60]);
  });
  it("parses typed digits and refuses blanks and zero", () => {
    expect(parseRange("45", "65")).toEqual({ start: 45, end: 65 });
    expect(parseRange("4a5", " 6 5")).toEqual({ start: 45, end: 65 });
    expect(parseRange("", "65")).toBeNull();
    expect(parseRange("0", "65")).toBeNull();
  });
});

describe("claiming", () => {
  it("lets another scout take an open request, writing who and when", () => {
    expect(checkCanClaim(make(), bob, T0 + 5)).toEqual({ ok: true });
    expect(claimPatch(bob, T0 + 5)).toEqual({ status: "claimed", claimedById: "bob", claimedByName: "Bob", claimedAt: T0 + 5 });
  });
  it("refuses the requester, a claimed, an expired and a cancelled request", () => {
    expect(checkCanClaim(make(), alice, T0).ok).toBe(false);
    expect(checkCanClaim(make(claimPatch(bob, T0)), { uid: "carol", name: "Carol" }, T0)).toMatchObject({ ok: false, reason: "Someone already took this sub-in." });
    expect(checkCanClaim(make(), bob, T0 + SUB_IN_TTL_MS)).toMatchObject({ ok: false, reason: "This request has expired." });
    expect(checkCanClaim(make({ status: "cancelled" }), bob, T0)).toMatchObject({ ok: false, reason: "This request was cancelled." });
  });
  it("only the requester cancels, and only while open", () => {
    expect(canCancel(make(), "alice", T0)).toBe(true);
    expect(canCancel(make(), "bob", T0)).toBe(false);
    expect(canCancel(make(claimPatch(bob, T0)), "alice", T0)).toBe(false);
    expect(canCancel(make(), "alice", T0 + SUB_IN_TTL_MS)).toBe(false);
    expect(cancelPatch()).toEqual({ status: "cancelled" });
  });
});

describe("what the dashboards show", () => {
  const open = make({ id: "a", requestedAt: T0, expiresAt: T0 + SUB_IN_TTL_MS });
  const newer = make({ id: "b", matchKey: "Q20", teamNumber: 1, requestedAt: T0 + 1000, expiresAt: T0 + 1000 + SUB_IN_TTL_MS });
  const claimed = make({ id: "c", matchKey: "Q30", teamNumber: 2, ...claimPatch(bob, T0 + 10) });
  const cancelled = make({ id: "d", status: "cancelled" });
  const otherEvent = make({ id: "e", eventKey: "2026lake" });
  const all = [open, newer, claimed, cancelled, otherEvent];
  it("lists the event's open and claimed requests, newest first, without cancelled ones", () => {
    expect(visibleRequests(all, "2026arli", T0 + 2000).map((r) => r.id)).toEqual(["b", "a", "c"].sort((x, y) => all.find((r) => r.id === y)!.requestedAt - all.find((r) => r.id === x)!.requestedAt));
  });
  it("drops an open request after 6 h", () => {
    expect(visibleRequests(all, "2026arli", T0 + SUB_IN_TTL_MS).map((r) => r.id)).toEqual(["b", "c"].sort((x, y) => all.find((r) => r.id === y)!.requestedAt - all.find((r) => r.id === x)!.requestedAt));
    expect(visibleRequests(all, "2026arli", T0 + SUB_IN_TTL_MS + 2000).map((r) => r.id)).not.toContain("b");
  });
  it("claimableFor leaves out my own and the taken ones", () => {
    expect(claimableFor(all, "2026arli", "alice", T0 + 2000)).toEqual([]);
    expect(claimableFor(all, "2026arli", "bob", T0 + 2000).map((r) => r.id).sort()).toEqual(["a", "b"]);
  });
  it("marks teams in a match for the picker, assigned over requested", () => {
    const q12Claimed = make({ id: "f", teamNumber: 254, ...claimPatch(bob, T0 + 5) });
    const q12Other = make({ id: "g", teamNumber: 971 });
    const marks = marksForMatch([open, q12Claimed, q12Other, claimed], "2026arli", "Q12", T0 + 10);
    expect(marks.get(254)).toBe("assigned");
    expect(marks.get(971)).toBe("requested");
    expect(marks.has(2)).toBe(false);
    expect(marksForMatch([open], "2026arli", "Q12", T0 + SUB_IN_TTL_MS).size).toBe(0);
  });
  it("turns what I claimed into assignments, keeping the claimed ones past 6 h", () => {
    expect(claimedAssignments(all, "2026arli", "bob")).toEqual([{ matchType: "Qualification", matchNumber: 30, teamNumber: 2, requestId: "c" }]);
    expect(claimedAssignments(all, "2026arli", "alice")).toEqual([]);
    expect(claimedAssignments(all, "2026lake", "bob")).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import {
  ANNOUNCEMENT_TYPES,
  MAX_ANNOUNCEMENT_LENGTH,
  buildAnnouncement,
  canDeleteAnnouncement,
  checkBody,
  isAnnouncementType,
  parseAnnouncement,
  sortNewestFirst,
  typeLabel,
  type TeamAnnouncement,
} from "./model";

const post = (id: string, createdAt: number, over: Partial<TeamAnnouncement> = {}): TeamAnnouncement => ({
  id,
  teamId: "t1",
  authorId: "u1",
  authorName: "Ann",
  body: "hello",
  type: "announcement",
  createdAt,
  ...over,
});

describe("parseAnnouncement", () => {
  it("reads CS's fields", () => {
    expect(parseAnnouncement("a", { teamId: "t1", authorId: "u1", authorName: "Ann", body: "Bus at 7", type: "match-alert", createdAt: 1700 })).toEqual({
      id: "a",
      teamId: "t1",
      authorId: "u1",
      authorName: "Ann",
      body: "Bus at 7",
      type: "match-alert",
      createdAt: 1700,
    });
  });

  it("falls back to an announcement for an unknown or missing type, and 0 for a bad time", () => {
    expect(parseAnnouncement("a", { type: "nope", createdAt: "soon" })).toMatchObject({ type: "announcement", createdAt: 0, body: "", authorName: "" });
    expect(parseAnnouncement("a", {}).type).toBe("announcement");
  });

  it("reads a Firestore Timestamp-like createdAt", () => {
    expect(parseAnnouncement("a", { createdAt: { toMillis: () => 4200 } }).createdAt).toBe(4200);
    expect(parseAnnouncement("a", { createdAt: { toMillis: () => "x" } }).createdAt).toBe(0);
  });

  it("ignores unknown fields", () => {
    expect(parseAnnouncement("a", { extra: 1 })).not.toHaveProperty("extra");
  });
});

describe("sortNewestFirst", () => {
  it("orders by createdAt descending without mutating the input", () => {
    const input = [post("a", 1), post("b", 3), post("c", 2)];
    expect(sortNewestFirst(input).map((p) => p.id)).toEqual(["b", "c", "a"]);
    expect(input.map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("breaks ties on id, so the order is stable", () => {
    expect(sortNewestFirst([post("b", 5), post("a", 5)]).map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("puts unreadable times (0) last", () => {
    expect(sortNewestFirst([post("a", 0), post("b", 9)]).map((p) => p.id)).toEqual(["b", "a"]);
  });
});

describe("checkBody", () => {
  it("trims the message", () => {
    expect(checkBody("  hi there \n")).toEqual({ ok: true, body: "hi there" });
  });

  it("refuses an empty or blank message with CS's wording", () => {
    for (const raw of ["", "   ", "\n\t"]) expect(checkBody(raw)).toEqual({ ok: false, reason: "Write a message before posting." });
  });

  it("refuses a message over the cap, accepts one at it", () => {
    expect(checkBody("x".repeat(MAX_ANNOUNCEMENT_LENGTH)).ok).toBe(true);
    expect(checkBody("x".repeat(MAX_ANNOUNCEMENT_LENGTH + 1)).ok).toBe(false);
  });
});

describe("buildAnnouncement", () => {
  it("writes CS's fields, with the poster as author (what the rules require)", () => {
    expect(buildAnnouncement({ teamId: "t1", actor: { uid: "u1", name: "Ann" }, body: "Hi", type: "strategy-note", now: 99 })).toEqual({
      teamId: "t1",
      authorId: "u1",
      authorName: "Ann",
      body: "Hi",
      type: "strategy-note",
      createdAt: 99,
    });
  });

  it("names a poster with no display name 'Team Member'", () => {
    expect(buildAnnouncement({ teamId: "t1", actor: { uid: "u1", name: "  " }, body: "Hi", type: "announcement", now: 1 }).authorName).toBe("Team Member");
  });
});

describe("types", () => {
  it("has CS's three types with labels", () => {
    expect(ANNOUNCEMENT_TYPES).toEqual(["announcement", "strategy-note", "match-alert"]);
    expect(ANNOUNCEMENT_TYPES.map(typeLabel)).toEqual(["Announcement", "Strategy Note", "Match Alert"]);
    expect(isAnnouncementType("match-alert")).toBe(true);
    expect(isAnnouncementType("chat")).toBe(false);
  });

  it("only a team admin deletes", () => {
    expect(canDeleteAnnouncement(true)).toBe(true);
    expect(canDeleteAnnouncement(false)).toBe(false);
  });
});

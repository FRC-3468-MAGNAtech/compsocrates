import { describe, expect, it } from "vitest";
import { DELETED_ACCOUNT_NAME, isDeletedAccountId } from "@/lib/deletion/constants";
import { FORMER_MEMBER_NAME, personName } from "@/lib/people/display-name";

const OPAQUE = "deleted-0123456789abcdef0123456789abcdef";
const members = [
  { uid: "u1", name: "Ada" },
  { uid: OPAQUE, name: DELETED_ACCOUNT_NAME },
  { uid: "u2", name: "  " },
];

describe("personName", () => {
  it("returns a roster member's name", () => expect(personName("u1", members)).toBe("Ada"));
  it("returns Deleted Account for an opaque id, on the roster or not", () => {
    expect(personName(OPAQUE, members)).toBe(DELETED_ACCOUNT_NAME);
    expect(personName(OPAQUE, [])).toBe(DELETED_ACCOUNT_NAME);
  });
  it("never returns a raw uid: an unknown or nameless uid gets the fallback", () => {
    expect(personName("zzz-real-uid", members)).toBe(FORMER_MEMBER_NAME);
    expect(personName("u2", members)).toBe(FORMER_MEMBER_NAME);
    expect(personName("zzz-real-uid", members, "Someone")).toBe("Someone");
    expect(personName(null, members)).toBe(FORMER_MEMBER_NAME);
  });
});

describe("isDeletedAccountId", () => {
  it("accepts only deleted- plus 32 lowercase hex", () => {
    expect(isDeletedAccountId(OPAQUE)).toBe(true);
    expect(isDeletedAccountId("deleted-xyz")).toBe(false);
    expect(isDeletedAccountId("deleted-0123456789ABCDEF0123456789abcdef")).toBe(false);
    expect(isDeletedAccountId("a real firebase uid 28 chars")).toBe(false);
    expect(isDeletedAccountId(undefined)).toBe(false);
  });
});

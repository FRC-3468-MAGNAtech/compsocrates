import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isOwnerEmail, isOwnerUid, isPlatformOwnerToken } from "@/lib/server/owner-admin";

const NAMES = ["RELEASE_OWNER_UIDS", "NEXT_PUBLIC_RELEASE_OWNER_UIDS", "RELEASE_OWNER_EMAILS", "OWNER_EMAILS", "ADMIN_EMAILS", "CS_OWNER_UIDS", "NEXT_PUBLIC_CS_OWNER_UIDS"];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const n of NAMES) {
    saved[n] = process.env[n];
    delete process.env[n];
  }
});
afterEach(() => {
  for (const n of NAMES) {
    if (saved[n] === undefined) delete process.env[n];
    else process.env[n] = saved[n];
  }
});

describe("platform owner detection (RELEASE_OWNER_UIDS / RELEASE_OWNER_EMAILS)", () => {
  it("recognises a uid from RELEASE_OWNER_UIDS exactly, and nobody when it is unset", () => {
    expect(isOwnerUid("AbC")).toBe(false);
    process.env.RELEASE_OWNER_UIDS = "AbC, def";
    expect(isOwnerUid("AbC")).toBe(true);
    expect(isOwnerUid("abc")).toBe(false); // uids are case sensitive
    expect(isOwnerUid("")).toBe(false);
    expect(isOwnerUid(undefined)).toBe(false);
  });

  it("recognises an email from RELEASE_OWNER_EMAILS case-insensitively", () => {
    process.env.RELEASE_OWNER_EMAILS = "Owner@Example.com";
    expect(isOwnerEmail("owner@example.com")).toBe(true);
    expect(isOwnerEmail("OWNER@EXAMPLE.COM")).toBe(true);
    expect(isOwnerEmail("other@example.com")).toBe(false);
    expect(isOwnerEmail(null)).toBe(false);
  });

  it("a token is a platform owner by uid alone, or by a verified email plus the claim", () => {
    process.env.RELEASE_OWNER_UIDS = "owner-uid";
    process.env.RELEASE_OWNER_EMAILS = "owner@example.com";
    expect(isPlatformOwnerToken({ uid: "owner-uid" })).toBe(true);
    expect(isPlatformOwnerToken({ uid: "x", email: "owner@example.com", email_verified: true, platformOwner: true })).toBe(true);
    expect(isPlatformOwnerToken({ uid: "x", email: "owner@example.com", email_verified: false, platformOwner: true })).toBe(false);
    expect(isPlatformOwnerToken({ uid: "x", email: "owner@example.com", email_verified: true })).toBe(false); // claim missing
    expect(isPlatformOwnerToken({ uid: "x", email: "other@example.com", email_verified: true, platformOwner: true })).toBe(false);
  });

  it("ignores the old variable names (OWNER_EMAILS, ADMIN_EMAILS, CS_OWNER_UIDS)", () => {
    process.env.OWNER_EMAILS = "owner@example.com";
    process.env.ADMIN_EMAILS = "owner@example.com";
    process.env.CS_OWNER_UIDS = "owner-uid";
    process.env.NEXT_PUBLIC_CS_OWNER_UIDS = "owner-uid";
    expect(isOwnerEmail("owner@example.com")).toBe(false);
    expect(isOwnerUid("owner-uid")).toBe(false);
    expect(isPlatformOwnerToken({ uid: "owner-uid", email: "owner@example.com", email_verified: true, platformOwner: true })).toBe(false);
  });
});

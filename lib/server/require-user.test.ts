import { beforeEach, describe, expect, it, vi } from "vitest";

const admin = vi.hoisted(() => ({ auth: null as null | { verifySessionCookie: (c: string, check: boolean) => Promise<{ uid: string }> }, problem: null as string | null }));
vi.mock("@/lib/firebase/admin", () => ({ getAdminAuth: () => admin.auth, firebaseAdminProblem: () => admin.problem }));

const cookieJar = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => (cookieJar.value ? { value: cookieJar.value } : undefined) }) }));

import { checkSession, requireUser, requireUserResult, serverSignInProblem } from "./require-user";

beforeEach(() => {
  admin.auth = null;
  admin.problem = null;
  cookieJar.value = undefined;
});

describe("when the Admin SDK is not configured", () => {
  beforeEach(() => {
    admin.problem = "Server sign-in is not configured: set FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL, FIREBASE_ADMIN_PRIVATE_KEY.";
  });

  it("says so, naming the variables, instead of 'not signed in'", async () => {
    expect(serverSignInProblem()).toContain("FIREBASE_ADMIN_PROJECT_ID");
    expect(await checkSession()).toMatchObject({ ok: false, reason: "not-configured" });
    const result = await requireUserResult();
    expect(result).toMatchObject({ ok: false, error: { code: "server_not_configured" } });
    expect(!result.ok && result.error.message).toBe(admin.problem);
    expect(await requireUser()).toBeNull();
  });
});

describe("when the Admin SDK is configured", () => {
  beforeEach(() => {
    admin.auth = { verifySessionCookie: async (cookie) => (cookie === "good" ? { uid: "u1" } : Promise.reject(new Error("expired"))) };
  });

  it("has no server problem", () => {
    expect(serverSignInProblem()).toBeNull();
  });

  it("no cookie is 'not signed in', not a server problem", async () => {
    expect(await requireUserResult()).toEqual({ ok: false, error: { code: "unauthorized", message: "Sign in to view event data." } });
  });

  it("a bad cookie is an expired session", async () => {
    cookieJar.value = "bad";
    expect(await checkSession()).toMatchObject({ ok: false, reason: "not-signed-in", message: "Your session has expired. Sign in again." });
  });

  it("a good cookie returns the uid", async () => {
    cookieJar.value = "good";
    expect(await requireUser()).toEqual({ uid: "u1" });
    expect(await requireUserResult()).toEqual({ ok: true, uid: "u1" });
  });
});

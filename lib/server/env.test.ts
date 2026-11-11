import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ENV_VARS, firebaseAdminEnv, firstApiCredentials, missingEnv, parseList, releaseOwnerEmails, releaseOwnerUids, tbaApiKey } from "./env";

const NAMES = ENV_VARS.map((v) => v.name).concat(["NEXT_PUBLIC_RELEASE_OWNER_UIDS"]);
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(NAMES.map((n) => [n, process.env[n]]));
  for (const n of NAMES) delete process.env[n];
});
afterEach(() => {
  for (const n of NAMES) {
    if (saved[n] === undefined) delete process.env[n];
    else process.env[n] = saved[n];
  }
});

describe("env getters", () => {
  it("reads the TBA key under the CompSocrates name and trims it", () => {
    expect(tbaApiKey()).toBeNull();
    process.env.NEXT_PUBLIC_TBA_API_KEY = "  abc123  ";
    expect(tbaApiKey()).toBe("abc123");
  });

  it("needs both FIRST parts", () => {
    process.env.FIRST_API_USERNAME = "user";
    expect(firstApiCredentials()).toBeNull();
    process.env.FIRST_API_TOKEN = "token";
    expect(firstApiCredentials()).toEqual({ username: "user", token: "token" });
  });

  it("parses owner lists and lowercases owner emails", () => {
    process.env.RELEASE_OWNER_UIDS = "AbC, def;AbC  ghi";
    process.env.RELEASE_OWNER_EMAILS = "Owner@Example.com, other@example.com";
    expect(releaseOwnerUids()).toEqual(["AbC", "def", "ghi"]);
    expect(releaseOwnerEmails()).toEqual(["owner@example.com", "other@example.com"]);
  });

  it("falls back to the browser copy of the owner uids", () => {
    process.env.NEXT_PUBLIC_RELEASE_OWNER_UIDS = "uid1";
    expect(releaseOwnerUids()).toEqual(["uid1"]);
  });

  it("returns the raw Admin values for the Admin module to validate", () => {
    process.env.FIREBASE_ADMIN_PROJECT_ID = " proj ";
    process.env.FIREBASE_ADMIN_PRIVATE_KEY = "line\\nbreak";
    expect(firebaseAdminEnv()).toEqual({ projectId: "proj", clientEmail: "", privateKey: "line\\nbreak" });
  });

  it("parseList drops empties and duplicates", () => {
    expect(parseList(" a,, b ;a")).toEqual(["a", "b"]);
  });
});

describe("missingEnv", () => {
  it("lists names and what breaks, never values", () => {
    process.env.NEXT_PUBLIC_TBA_API_KEY = "super-secret-value";
    const missing = missingEnv();
    expect(missing.find((v) => v.name === "NEXT_PUBLIC_TBA_API_KEY")).toBeUndefined();
    expect(missing.find((v) => v.name === "FIRST_API_TOKEN")?.whenMissing).toMatch(/practice/i);
    expect(JSON.stringify(missing)).not.toContain("super-secret-value");
  });

  it("treats owner uids and owner emails as alternatives", () => {
    expect(missingEnv().some((v) => v.name === "RELEASE_OWNER_UIDS")).toBe(true);
    process.env.RELEASE_OWNER_EMAILS = "owner@example.com";
    expect(missingEnv().some((v) => v.name === "RELEASE_OWNER_UIDS" || v.name === "RELEASE_OWNER_EMAILS")).toBe(false);
  });

  it("filters by group, and optional variables are not reported by default", () => {
    expect(missingEnv().every((v) => v.group !== "optional")).toBe(true);
    expect(missingEnv(["optional"]).every((v) => v.group === "optional")).toBe(true);
  });

  it("every variable name is documented once", () => {
    const names = ENV_VARS.map((v) => v.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

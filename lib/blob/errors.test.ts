import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyBlobError, isStoreAccessMismatch, STORE_ACCESS_MISMATCH_DETAIL, STORE_ACCESS_MISMATCH_FRIENDLY, storeAccessMismatchText } from "./errors";

// The SDK has no error class for an access-mode mismatch; the service's own text comes through as "Vercel Blob: <message>" (see errors.ts). The first two
// messages are the service wording this matcher is written for (not verifiable here without a real store); the rest are the SDK's FIXED messages and ordinary
// failures, which must stay plain store failures.
const MISMATCH_TEXTS = [
  "Vercel Blob: Cannot use public access on a private store. The store is configured for private access.",
  "Vercel Blob: Cannot use private access on a public store. The store is configured for public access.",
  "Vercel Blob: store is configured for private access, but access public was requested",
];
const OTHER_TEXTS = [
  "Vercel Blob: Access denied, please provide a valid token for this resource.",
  "Vercel Blob: This store does not exist.",
  "Vercel Blob: This store has been suspended.",
  "Vercel Blob: Unknown error, please visit https://vercel.com/help.",
  "Vercel Blob: The blob service is currently not available. Please try again.",
  'Vercel Blob: Content type mismatch, contentType "image/svg+xml" is not allowed.',
  "Vercel Blob: Bad request",
  "store down",
  "fetch failed",
];

afterEach(() => vi.unstubAllEnvs());

describe("isStoreAccessMismatch", () => {
  it("recognises the access-mode mismatch text the service sends through", () => {
    for (const m of MISMATCH_TEXTS) expect(isStoreAccessMismatch(new Error(m)), m).toBe(true);
  });
  it("leaves every other failure alone", () => {
    for (const m of OTHER_TEXTS) expect(isStoreAccessMismatch(new Error(m)), m).toBe(false);
    for (const v of [null, undefined, 5, {}, ""]) expect(isStoreAccessMismatch(v)).toBe(false);
  });
});

describe("classifyBlobError", () => {
  it("is store-access-mismatch for a mismatch and the fallback for anything else", () => {
    expect(classifyBlobError(new Error(MISMATCH_TEXTS[0]))).toBe("store-access-mismatch");
    expect(classifyBlobError(new Error(OTHER_TEXTS[0]))).toBe("store-failed");
    expect(classifyBlobError(new Error("x"), "error")).toBe("error");
  });
});

describe("storeAccessMismatchText", () => {
  it("adds the developer detail outside production only, and never names a store or a variable", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(storeAccessMismatchText()).toBe(`${STORE_ACCESS_MISMATCH_FRIENDLY} (${STORE_ACCESS_MISMATCH_DETAIL})`);
    expect(STORE_ACCESS_MISMATCH_DETAIL).toBe("Blob store access mode does not match");
    vi.stubEnv("NODE_ENV", "production");
    expect(storeAccessMismatchText()).toBe(STORE_ACCESS_MISMATCH_FRIENDLY);
    expect(STORE_ACCESS_MISMATCH_FRIENDLY).not.toMatch(/BLOB|token|store/i);
  });
});

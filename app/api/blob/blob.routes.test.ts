import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Form-photo routes with `@vercel/blob`, `@vercel/blob/client`, the environment, sign-in and the permission check mocked: no real Blob store, no Firebase.
const PUB = "vercel_blob_rw_pubstore1_secret";
const LEG = "vercel_blob_rw_legstore1_secret";
const mocks = vi.hoisted(() => ({ verify: vi.fn(), db: vi.fn(), pub: vi.fn(), legacy: vi.fn(), del: vi.fn(), handleUpload: vi.fn(), authorize: vi.fn() }));
vi.mock("@vercel/blob", () => ({ del: mocks.del }));
vi.mock("@vercel/blob/client", () => ({ handleUpload: mocks.handleUpload }));
vi.mock("@/lib/server/env", () => ({ publicBlobToken: mocks.pub, blobToken: mocks.legacy }));
vi.mock("@/lib/server/require-user", () => ({ verifyBearerToken: mocks.verify }));
vi.mock("@/lib/firebase/admin", () => ({ getAdminFirestore: mocks.db }));
vi.mock("@/lib/server/blob-auth", async () => ({ ...(await vi.importActual<typeof import("@/lib/server/blob-auth")>("@/lib/server/blob-auth")), authorizeBlobDelete: mocks.authorize }));

import { POST as upload } from "@/app/api/blob/upload/route";
import { POST as remove } from "@/app/api/blob/delete/route";

const postJson = (url: string, body: unknown) => new Request(url, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer x" }, body: JSON.stringify(body) });
const callUpload = () => upload(postJson("http://localhost/api/blob/upload", { type: "blob.upload-completed", payload: {} }));
const callDelete = (url: unknown) => remove(postJson("http://localhost/api/blob/delete", { url }));
const pubUrl = "https://pubstore1.public.blob.vercel-storage.com/forms/t1/pit/e/1/tag/abc.jpg";
const legUrl = "https://legstore1.private.blob.vercel-storage.com/forms/t1/pit/e/1/tag/old.jpg";

beforeEach(() => {
  mocks.verify.mockReset().mockResolvedValue({ uid: "u1" });
  mocks.db.mockReset().mockReturnValue({});
  mocks.pub.mockReset().mockReturnValue(PUB);
  mocks.legacy.mockReset().mockReturnValue(LEG);
  mocks.del.mockReset().mockResolvedValue(undefined);
  mocks.handleUpload.mockReset().mockResolvedValue({ type: "blob.upload-completed", response: "ok" });
  mocks.authorize.mockReset().mockImplementation(async ({ url }: { url: string }) => ({ ok: true, pathname: new URL(url).pathname.slice(1), parts: {} }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/blob/upload", () => {
  it("hands handleUpload the PUBLIC store's token (never the legacy one)", async () => {
    const res = await callUpload();
    expect(res.status).toBe(200);
    expect(mocks.handleUpload).toHaveBeenCalledTimes(1);
    expect(mocks.handleUpload.mock.calls[0][0].token).toBe(PUB);
  });
  it("503 not-configured naming BLOB_PUBLIC_READ_WRITE_TOKEN when it is unset, even if the legacy token is set", async () => {
    mocks.pub.mockReturnValue(null);
    const res = await callUpload();
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.code).toBe("not-configured");
    expect(json.error).toContain("BLOB_PUBLIC_READ_WRITE_TOKEN");
    expect(mocks.handleUpload).not.toHaveBeenCalled();
  });
  it("an access-mode mismatch is 502 store-access-mismatch (friendly, with the developer detail only outside production)", async () => {
    mocks.handleUpload.mockRejectedValue(new Error("Vercel Blob: Cannot use public access on a private store. The store is configured for private access."));
    vi.stubEnv("NODE_ENV", "development");
    const dev = await callUpload();
    expect(dev.status).toBe(502);
    const devJson = await dev.json();
    expect(devJson.code).toBe("store-access-mismatch");
    expect(devJson.error).toContain("Blob store access mode does not match");
    vi.stubEnv("NODE_ENV", "production");
    expect((await (await callUpload()).json()).error).toBe("Photo uploads aren't available right now. Please tell a team admin.");
  });
  it("any other failure keeps the generic error", async () => {
    mocks.handleUpload.mockRejectedValue(new Error("boom"));
    const res = await callUpload();
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("error");
  });
});

describe("POST /api/blob/delete: the token follows the URL's host", () => {
  it("a file in the public store is deleted with the public token", async () => {
    const res = await callDelete(pubUrl);
    expect(res.status).toBe(200);
    expect(mocks.del).toHaveBeenCalledWith("forms/t1/pit/e/1/tag/abc.jpg", { token: PUB });
  });
  it("a file in the legacy store is deleted with the legacy token", async () => {
    const res = await callDelete(legUrl);
    expect(res.status).toBe(200);
    expect(mocks.del).toHaveBeenCalledWith("forms/t1/pit/e/1/tag/old.jpg", { token: LEG });
  });
  it("an unknown host or another store is refused (400) and nothing is deleted or even permission-checked with a token", async () => {
    for (const url of ["https://example.com/forms/x.jpg", "https://otherstore9.public.blob.vercel-storage.com/forms/x.jpg", "https://legstore1.public.blob.vercel-storage.com/forms/x.jpg"]) {
      const res = await callDelete(url);
      expect(res.status, url).toBe(400);
      expect((await res.json()).code).toBe("unknown-store");
    }
    expect(mocks.del).not.toHaveBeenCalled();
    expect(mocks.authorize).not.toHaveBeenCalled();
  });
  it("a missing token for the matching store is a 503 naming that variable (and the other store's token is not used instead)", async () => {
    mocks.pub.mockReturnValue(null);
    const a = await callDelete(pubUrl);
    expect(a.status).toBe(503);
    expect((await a.json()).error).toContain("BLOB_PUBLIC_READ_WRITE_TOKEN");
    mocks.pub.mockReturnValue(PUB);
    mocks.legacy.mockReturnValue(null);
    const b = await callDelete(legUrl);
    expect(b.status).toBe(503);
    const bJson = await b.json();
    expect(bJson.code).toBe("not-configured");
    expect(bJson.error).toContain("BLOB_READ_WRITE_TOKEN");
    expect(mocks.del).not.toHaveBeenCalled();
  });
  it("the permission check still runs for a file in a known store (a denial deletes nothing)", async () => {
    mocks.authorize.mockResolvedValue({ ok: false, status: 403, code: "not-yours", message: "Only the person who uploaded a photo, or an admin, can delete it." });
    const res = await callDelete(pubUrl);
    expect(res.status).toBe(403);
    expect(mocks.del).not.toHaveBeenCalled();
  });
  it("an access-mode mismatch from the store is 502 store-access-mismatch; other failures stay 500", async () => {
    mocks.del.mockRejectedValueOnce(new Error("Vercel Blob: Cannot use public access on a private store."));
    const a = await callDelete(pubUrl);
    expect(a.status).toBe(502);
    expect((await a.json()).code).toBe("store-access-mismatch");
    mocks.del.mockRejectedValueOnce(new Error("Vercel Blob: Unknown error, please visit https://vercel.com/help."));
    expect((await callDelete(pubUrl)).status).toBe(500);
  });
  it("401 without a signed-in user", async () => {
    mocks.verify.mockResolvedValue(null);
    expect((await callDelete(pubUrl)).status).toBe(401);
  });
});

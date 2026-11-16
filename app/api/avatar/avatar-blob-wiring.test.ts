import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFirestore } from "@/lib/server/test-support/fake-firestore";

// `@vercel/blob` and the environment are mocked: nothing here reaches a real Blob store. The routes, avatar service and the REAL vercelAvatarStore run, so this
// checks exactly which token and `access` value reach the SDK.
const PUB = "vercel_blob_rw_pubstore1_secret";
const LEG = "vercel_blob_rw_legstore1_secret";
const HOST = "pubstore1.public.blob.vercel-storage.com";
const mocks = vi.hoisted(() => ({ verify: vi.fn(), problem: vi.fn(), db: vi.fn(), pub: vi.fn(), legacy: vi.fn(), put: vi.fn(), del: vi.fn(), list: vi.fn() }));
vi.mock("@vercel/blob", () => ({ put: mocks.put, del: mocks.del, list: mocks.list }));
vi.mock("@/lib/server/env", () => ({ publicBlobToken: mocks.pub, blobToken: mocks.legacy }));
vi.mock("@/lib/server/require-user", () => ({ verifyBearerToken: mocks.verify, serverSignInProblem: mocks.problem }));
vi.mock("@/lib/firebase/admin", () => ({ getAdminFirestore: mocks.db, getAdminFirestoreRest: () => null }));
vi.mock("@/lib/server/owner-admin", () => ({ isPlatformOwnerToken: () => false }));

import { DELETE, POST } from "@/app/api/avatar/route";
import { POST as removeMember } from "@/app/api/avatar/remove/route";
import { deleteAvatarBlobs, vercelAvatarStore } from "@/lib/server/avatar-blobs";

const jpeg = () => sharp({ create: { width: 64, height: 32, channels: 3, background: { r: 10, g: 120, b: 200 } } }).jpeg().toBuffer();
const send = async () => POST(new Request("http://localhost/api/avatar", { method: "POST", headers: { authorization: "Bearer x", "content-type": "image/jpeg" }, body: new Uint8Array(await jpeg()) }));
const del = () => DELETE(new Request("http://localhost/api/avatar", { method: "DELETE", headers: { authorization: "Bearer x" } }));

let fake: FakeFirestore;
beforeEach(() => {
  fake = new FakeFirestore();
  fake.seed("users/u1", { displayName: "Una", teamId: "ALPHA" });
  fake.seed("users/admin1", { displayName: "Admin", teamId: "ALPHA", isTeamAdmin: true });
  mocks.verify.mockReset().mockResolvedValue({ uid: "u1", name: "Una" });
  mocks.problem.mockReset().mockReturnValue(null);
  mocks.db.mockReset().mockImplementation(() => fake.asFirestore());
  mocks.pub.mockReset().mockReturnValue(PUB);
  mocks.legacy.mockReset().mockReturnValue(LEG);
  mocks.put.mockReset().mockImplementation(async (path: string) => ({ url: `https://${HOST}/${path}` }));
  mocks.del.mockReset().mockResolvedValue(undefined);
  mocks.list.mockReset().mockResolvedValue({ blobs: [], hasMore: false });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("upload passes the public store's token and access: public", () => {
  it("put() gets the BLOB_PUBLIC token (not the legacy one) and access public", async () => {
    const res = await send();
    expect(res.status).toBe(200);
    expect(mocks.put).toHaveBeenCalledTimes(1);
    const options = mocks.put.mock.calls[0][2] as { token: string; access: string };
    expect(options.token).toBe(PUB);
    expect(options.token).not.toBe(LEG);
    expect(options.access).toBe("public");
  });
  it("503 not-configured naming BLOB_PUBLIC_READ_WRITE_TOKEN when it is unset, even if the legacy token is set; nothing reaches the SDK", async () => {
    mocks.pub.mockReturnValue(null);
    const res = await send();
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.code).toBe("not-configured");
    expect(json.error).toContain("BLOB_PUBLIC_READ_WRITE_TOKEN");
    expect(mocks.put).not.toHaveBeenCalled();
    expect((await del()).status).toBe(503);
    expect(mocks.list).not.toHaveBeenCalled();
  });
});

describe("an access-mode mismatch from the store", () => {
  const mismatch = () => mocks.put.mockRejectedValue(new Error("Vercel Blob: Cannot use public access on a private store. The store is configured for private access."));
  it("is 502 store-access-mismatch with a friendly line plus the developer detail in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    mismatch();
    const res = await send();
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.code).toBe("store-access-mismatch");
    expect(json.error).toContain("Photo uploads aren't available right now");
    expect(json.error).toContain("Blob store access mode does not match");
    expect(JSON.stringify(json)).not.toContain(PUB);
  });
  it("is only the friendly line in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    mismatch();
    const json = await (await send()).json();
    expect(json.code).toBe("store-access-mismatch");
    expect(json.error).toBe("Photo uploads aren't available right now. Please tell a team admin.");
  });
  it("any other store failure stays store-failed", async () => {
    mocks.put.mockRejectedValue(new Error("Vercel Blob: Unknown error, please visit https://vercel.com/help."));
    const res = await send();
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("store-failed");
  });
  it("is also reported when a delete hits it", async () => {
    mocks.list.mockRejectedValue(new Error("Vercel Blob: Cannot use public access on a private store."));
    const res = await del();
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("store-access-mismatch");
  });
});

describe("delete and list use the same (public) token", () => {
  it("DELETE /api/avatar lists the person's folder and deletes what it found, both with the public token", async () => {
    mocks.list.mockResolvedValue({ blobs: [{ url: `https://${HOST}/avatars/u1/a.webp` }, { url: `https://${HOST}/avatars/u1/b.webp` }], hasMore: false });
    const res = await del();
    expect(res.status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ prefix: "avatars/u1/", token: PUB }));
    expect(mocks.del).toHaveBeenCalledWith([`https://${HOST}/avatars/u1/a.webp`, `https://${HOST}/avatars/u1/b.webp`], { token: PUB });
  });
  it("a team admin's removal of a member uses the public token for list and delete", async () => {
    fake.seed("users/u2", { displayName: "Dee", teamId: "ALPHA" });
    mocks.verify.mockResolvedValue({ uid: "admin1", name: "Admin" });
    mocks.list.mockResolvedValue({ blobs: [{ url: `https://${HOST}/avatars/u2/a.webp` }], hasMore: false });
    const res = await removeMember(new Request("http://localhost/api/avatar/remove", { method: "POST", headers: { authorization: "Bearer x", "content-type": "application/json" }, body: JSON.stringify({ program: "frc", uid: "u2" }) }));
    expect(res.status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ token: PUB }));
    expect(mocks.del).toHaveBeenCalledWith([`https://${HOST}/avatars/u2/a.webp`], { token: PUB });
  });
  it("deleteAvatarBlobs (the account-deletion hook) uses the public token, and throws naming the variable when it is unset", async () => {
    mocks.list.mockResolvedValue({ blobs: [{ url: `https://${HOST}/avatars/u1/a.webp` }], hasMore: false });
    expect(await deleteAvatarBlobs("u1")).toBe(1);
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ token: PUB }));
    expect(mocks.del).toHaveBeenCalledWith([`https://${HOST}/avatars/u1/a.webp`], { token: PUB });
    mocks.pub.mockReturnValue(null);
    await expect(deleteAvatarBlobs("u1")).rejects.toThrow("BLOB_PUBLIC_READ_WRITE_TOKEN");
  });
  it("a URL on another store's host is never deleted with this token", async () => {
    await vercelAvatarStore(PUB).remove([`https://legstore1.private.blob.vercel-storage.com/avatars/u1/x.webp`, "https://example.com/avatars/u1/y.webp", `https://${HOST}/avatars/u1/z.webp`]);
    expect(mocks.del).toHaveBeenCalledTimes(1);
    expect(mocks.del).toHaveBeenCalledWith([`https://${HOST}/avatars/u1/z.webp`], { token: PUB });
    mocks.del.mockClear();
    await vercelAvatarStore(PUB).remove(["https://example.com/avatars/u1/y.webp"]);
    expect(mocks.del).not.toHaveBeenCalled();
  });
});

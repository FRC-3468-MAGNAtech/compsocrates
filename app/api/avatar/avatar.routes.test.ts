import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFirestore } from "@/lib/server/test-support/fake-firestore";
import type { AvatarBlobStore } from "@/lib/server/avatar-blobs";

// Token verification, the owner check, the Blob token and the Blob store are mocked. The routes, the image pipeline (the REAL image library, small synthetic
// bytes), the service rules and the Firestore writes (an in-memory fake) run for real. No emulator, no network, no real project, no real Blob store.
const HOST = "teststore1.public.blob.vercel-storage.com";
const mocks = vi.hoisted(() => ({ verify: vi.fn(), problem: vi.fn(), db: vi.fn(), token: vi.fn(), host: vi.fn(), store: { current: null as unknown } }));
vi.mock("@/lib/server/require-user", () => ({ verifyBearerToken: mocks.verify, serverSignInProblem: mocks.problem }));
vi.mock("@/lib/firebase/admin", () => ({ getAdminFirestore: mocks.db, getAdminFirestoreRest: () => null }));
vi.mock("@/lib/server/owner-admin", () => ({ isPlatformOwnerToken: (d: { uid?: string }) => d.uid === "owner" }));
vi.mock("@/lib/server/env", () => ({ blobToken: mocks.token }));
vi.mock("@/lib/server/avatar-blobs", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server/avatar-blobs")>("@/lib/server/avatar-blobs");
  return { ...actual, vercelAvatarStore: () => mocks.store.current, avatarStoreHost: mocks.host };
});

import { DELETE, POST } from "@/app/api/avatar/route";
import { POST as removeMember } from "@/app/api/avatar/remove/route";
import { POST as ownerSwitch } from "@/app/api/admin/avatar-uploads/route";
import { deleteAvatarBlobs } from "@/lib/server/avatar-blobs";
import { AVATAR_MAX_PIXELS } from "@/lib/server/avatar-image";
import { UPLOADS_PER_HOUR } from "@/lib/server/avatar-service";

class FakeBlobStore implements AvatarBlobStore {
  files = new Map<string, Buffer>();
  host = HOST;
  failPut = false;
  urlOf = (path: string) => `https://${this.host}/${path}`;
  async put(path: string, data: Buffer) {
    if (this.failPut) throw new Error("store down");
    this.files.set(path, data);
    return { url: this.urlOf(path) };
  }
  async remove(urls: string[]) {
    for (const u of urls) this.files.delete(new URL(u).pathname.replace(/^\//, ""));
  }
  async listUrls(prefix: string) {
    return [...this.files.keys()].filter((k) => k.startsWith(prefix)).map(this.urlOf);
  }
}

const solid = (w = 64, h = 32) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 10, g: 120, b: 200 } } });
const jpeg = (w?: number, h?: number) => solid(w, h).jpeg().toBuffer();
const send = (bytes: Uint8Array | Buffer, headers: Record<string, string> = {}) =>
  POST(new Request("http://localhost/api/avatar", { method: "POST", headers: { authorization: "Bearer x", "content-type": "image/jpeg", ...headers }, body: new Uint8Array(bytes) }));
const del = () => DELETE(new Request("http://localhost/api/avatar", { method: "DELETE", headers: { authorization: "Bearer x" } }));
const adminRemove = (body: unknown) => removeMember(new Request("http://localhost/api/avatar/remove", { method: "POST", headers: { authorization: "Bearer x", "content-type": "application/json" }, body: JSON.stringify(body) }));
const signIn = (uid: string) => mocks.verify.mockResolvedValue({ uid, name: `Name ${uid}`, email: "private@example.test" });

let fake: FakeFirestore;
let store: FakeBlobStore;
beforeEach(() => {
  fake = new FakeFirestore();
  store = new FakeBlobStore();
  mocks.store.current = store;
  fake.seed("users/u1", { displayName: "Una", teamId: "ALPHA", avatar: { type: "preset", value: "bot" } });
  fake.seed("programs/ftc/users/u1", { name: "Una", teamId: "ZED", isAdmin: false, primaryRole: "match-scout", secondaryRoles: [] });
  fake.seed("users/u2", { displayName: "Dee", teamId: "ALPHA" });
  fake.seed("users/admin1", { displayName: "Alpha Admin", teamId: "ALPHA", isTeamAdmin: true });
  fake.seed("users/admin2", { displayName: "Beta Admin", teamId: "BETA", isTeamAdmin: true });
  fake.seed("users/noaccount-sibling", { displayName: "Sib", teamId: "ALPHA" });
  mocks.verify.mockReset();
  mocks.problem.mockReset().mockReturnValue(null);
  mocks.db.mockReset().mockImplementation(() => fake.asFirestore());
  mocks.token.mockReset().mockReturnValue("vercel_blob_rw_teststore1_secret");
  mocks.host.mockReset().mockReturnValue(HOST);
});

describe("access and configuration", () => {
  it("503 not-configured, naming the variable, when the Blob token is missing (nothing else is touched)", async () => {
    mocks.token.mockReturnValue(null);
    signIn("u1");
    const res = await send(await jpeg());
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.code).toBe("not-configured");
    expect(json.error).toContain("BLOB_READ_WRITE_TOKEN");
    expect((await del()).status).toBe(503);
  });
  it("401 with no token or a bad token; 503 server_not_configured when the Admin SDK is missing", async () => {
    mocks.verify.mockResolvedValue(null);
    expect((await send(await jpeg())).status).toBe(401);
    mocks.problem.mockReturnValue("Server sign-in is not configured: set FIREBASE_ADMIN_CLIENT_EMAIL and FIREBASE_ADMIN_PRIVATE_KEY.");
    const res = await send(await jpeg());
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("server_not_configured");
  });
  it("403 uploads-off when the platform owner has turned uploads off; the stored photo is untouched", async () => {
    signIn("u1");
    fake.seed("appSettings/global", { avatarUploadsEnabled: false });
    const res = await send(await jpeg());
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("uploads-off");
    expect(store.files.size).toBe(0);
  });
  it("uploads are on when the switch is missing", async () => {
    signIn("u1");
    expect((await send(await jpeg())).status).toBe(200);
  });
});

describe("what is refused", () => {
  it("wrong types: SVG, text, GIF; and a spoofed MIME (an SVG sent as image/jpeg)", async () => {
    signIn("u1");
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>');
    for (const bytes of [svg, Buffer.from("plain text"), await solid(8, 8).gif().toBuffer()]) {
      const res = await send(bytes, { "content-type": "image/jpeg" });
      expect(res.status).toBe(415);
      expect((await res.json()).code).toBe("wrong-type");
    }
    expect(store.files.size).toBe(0);
  });
  it("an oversized body is a 413 too-big, by header and by actual size", async () => {
    signIn("u1");
    const big = Buffer.alloc(3 * 1024 * 1024 + 1, 7);
    const byHeader = await send(new Uint8Array(10), { "content-length": String(big.length) });
    expect(byHeader.status).toBe(413);
    const bySize = await send(big);
    expect(bySize.status).toBe(413);
    expect((await bySize.json()).code).toBe("too-big");
    expect(store.files.size).toBe(0);
  });
  it("too many pixels is refused before decoding", async () => {
    signIn("u1");
    const side = Math.ceil(Math.sqrt(AVATAR_MAX_PIXELS)) + 10;
    const huge = await sharp({ create: { width: side, height: side, channels: 3, background: "#fff" } }).png({ compressionLevel: 9 }).toBuffer();
    expect(huge.length).toBeLessThan(3 * 1024 * 1024);
    const res = await send(huge);
    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe("too-big");
    expect(store.files.size).toBe(0);
  }, 60000);
  it("a corrupt picture fails closed (422) and stores nothing", async () => {
    signIn("u1");
    const res = await send((await jpeg()).subarray(0, 40));
    expect(res.status).toBe(422);
    expect(store.files.size).toBe(0);
    expect(fake.read("users/u1")?.avatarUrl).toBeUndefined();
  });
  it("an empty body is refused", async () => {
    signIn("u1");
    expect((await send(new Uint8Array(0))).status).toBe(400);
  });
  it("an account with no document yet is refused", async () => {
    signIn("ghost");
    expect((await send(await jpeg())).status).toBe(403);
    expect(store.files.size).toBe(0);
  });
  it("is rate limited per person (10 an hour)", async () => {
    signIn("u1");
    const bytes = await jpeg(32, 32);
    for (let i = 0; i < UPLOADS_PER_HOUR; i++) expect((await send(bytes)).status).toBe(200);
    const res = await send(bytes);
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe("rate-limited");
  });
  it("a store that answers with a URL on another host is refused, and the file is removed again", async () => {
    signIn("u1");
    store.host = "other.public.blob.vercel-storage.com";
    const res = await send(await jpeg());
    expect(res.status).toBe(502);
    expect(store.files.size).toBe(0);
    expect(fake.read("users/u1")?.avatarUrl).toBeUndefined();
  });
  it("a store failure is a 502 and nothing is written", async () => {
    signIn("u1");
    store.failPut = true;
    expect((await send(await jpeg())).status).toBe(502);
    expect(fake.read("users/u1")?.avatarUrl).toBeUndefined();
  });
});

describe("a good upload", () => {
  it("re-encodes to a 512 px square WebP with no metadata, under a uid-keyed unguessable path, and sets the fields on every account document", async () => {
    signIn("u1");
    const withExif = await solid(200, 120)
      .jpeg()
      .withExif({ IFD0: { Make: "SecretCam", Copyright: "private person" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "37/1 25/1 1912/100", GPSLongitudeRef: "W", GPSLongitude: "122/1 5/1 2476/100" } })
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();
    const res = await send(withExif);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.path).toMatch(/^avatars\/u1\/[0-9a-f]{32}\.webp$/);
    expect(json.url).toBe(`https://${HOST}/${json.path}`);

    const stored = store.files.get(json.path)!;
    const meta = await sharp(stored).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["webp", 512, 512]);
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(stored.includes(Buffer.from("SecretCam"))).toBe(false);
    expect(stored.includes(Buffer.from("GPS"))).toBe(false);

    for (const path of ["users/u1", "programs/ftc/users/u1"]) {
      expect(fake.read(path)).toMatchObject({ avatarUrl: json.url, avatarBlobPath: json.path, avatarSource: "upload" });
    }
    // The existing avatar field is untouched, and nobody else's document is.
    expect(fake.read("users/u1")?.avatar).toEqual({ type: "preset", value: "bot" });
    expect(fake.read("users/u2")?.avatarUrl).toBeUndefined();
  });
  it("replacing deletes the previous blob and any stray in the folder, never another person's", async () => {
    signIn("u1");
    store.files.set("avatars/u2/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp", Buffer.from("other person"));
    const first = await (await send(await jpeg())).json();
    store.files.set("avatars/u1/stray0000000000000000000000000000.webp", Buffer.from("stray"));
    const second = await (await send(await jpeg())).json();
    expect(second.path).not.toBe(first.path);
    expect([...store.files.keys()].filter((k) => k.startsWith("avatars/u1/"))).toEqual([second.path]);
    expect(store.files.has("avatars/u2/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp")).toBe(true);
    expect(fake.read("users/u1")?.avatarUrl).toBe(second.url);
  });
});

describe("removing your own photo", () => {
  it("deletes the blob(s) and clears the fields everywhere; the existing avatar choice stays", async () => {
    signIn("u1");
    const up = await (await send(await jpeg())).json();
    store.files.set("avatars/u1/stray0000000000000000000000000000.webp", Buffer.from("stray"));
    const res = await del();
    expect(res.status).toBe(200);
    expect((await res.json()).removed).toBe(true);
    expect([...store.files.keys()].filter((k) => k.startsWith("avatars/u1/"))).toEqual([]);
    for (const path of ["users/u1", "programs/ftc/users/u1"]) {
      const d = fake.read(path)!;
      expect([d.avatarUrl ?? null, d.avatarBlobPath ?? null, d.avatarSource ?? null]).toEqual([null, null, null]);
    }
    expect(fake.read("users/u1")?.avatar).toEqual({ type: "preset", value: "bot" });
    expect(up.url).toBeTruthy();
  });
  it("is idempotent", async () => {
    signIn("u1");
    const first = await del();
    expect(first.status).toBe(200);
    expect((await first.json()).removed).toBe(false);
    expect((await del()).status).toBe(200);
  });
  it("a failed delete changes nothing and says so", async () => {
    signIn("u1");
    await send(await jpeg());
    store.remove = async () => {
      throw new Error("down");
    };
    const res = await del();
    expect(res.status).toBe(502);
    expect(fake.read("users/u1")?.avatarSource).toBe("upload");
  });
});

describe("an admin removing a member's photo", () => {
  const seedPhoto = async () => {
    signIn("u2");
    const up = await (await send(await jpeg())).json();
    return up as { path: string; url: string };
  };
  it("a same-team admin removes it: blob deleted, fields cleared, an audit entry under the root path, nobody notified", async () => {
    await seedPhoto();
    signIn("admin1");
    const res = await adminRemove({ program: "frc", uid: "u2" });
    expect(res.status).toBe(200);
    expect((await res.json()).removed).toBe(true);
    expect([...store.files.keys()].filter((k) => k.startsWith("avatars/u2/"))).toEqual([]);
    expect(fake.read("users/u2")?.avatarSource ?? null).toBeNull();
    const audits = fake.ids("auditLog").map((id) => fake.read(`auditLog/${id}`));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ teamId: "ALPHA", uid: "admin1", action: "remove-member-photo", target: { targetUid: "u2" } });
    expect(fake.ids("notifications")).toHaveLength(0);
    expect(fake.ids("programs/ftc/auditLog")).toHaveLength(0);
  });
  it("an admin of ANOTHER team is refused, and the photo stays", async () => {
    const up = await seedPhoto();
    signIn("admin2");
    const res = await adminRemove({ program: "frc", uid: "u2" });
    expect(res.status).toBe(403);
    expect(store.files.has(up.path)).toBe(true);
    expect(fake.read("users/u2")?.avatarSource).toBe("upload");
    expect(fake.ids("auditLog")).toHaveLength(0);
  });
  it("a plain member is refused; the platform owner may remove any member's photo", async () => {
    await seedPhoto();
    signIn("u1");
    expect((await adminRemove({ program: "frc", uid: "u2" })).status).toBe(403);
    signIn("owner");
    expect((await adminRemove({ program: "frc", uid: "u2" })).status).toBe(200);
    expect(fake.read("users/u2")?.avatarSource ?? null).toBeNull();
  });
  it("is idempotent: a second removal succeeds and writes no second audit entry", async () => {
    await seedPhoto();
    signIn("admin1");
    await adminRemove({ program: "frc", uid: "u2" });
    const again = await adminRemove({ program: "frc", uid: "u2" });
    expect(again.status).toBe(200);
    expect((await again.json()).removed).toBe(false);
    expect(fake.ids("auditLog")).toHaveLength(1);
  });
  it("needs the program and a valid member, and the Blob token", async () => {
    signIn("admin1");
    expect((await adminRemove({ uid: "u2" })).status).toBe(400);
    expect((await adminRemove({ program: "frc", uid: "../x" })).status).toBe(400);
    mocks.token.mockReturnValue(null);
    expect((await adminRemove({ program: "frc", uid: "u2" })).status).toBe(503);
  });
});

describe("deleteAvatarBlobs(uid) (the hook for account deletion)", () => {
  it("lists the person's folder and deletes everything in it, strays included, and nothing outside it", async () => {
    store.files.set("avatars/u1/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp", Buffer.from("a"));
    store.files.set("avatars/u1/stray0000000000000000000000000000.webp", Buffer.from("b"));
    store.files.set("avatars/u10/cccccccccccccccccccccccccccccccc.webp", Buffer.from("c"));
    store.files.set("forms/ALPHA/photo.webp", Buffer.from("d"));
    expect(await deleteAvatarBlobs("u1", store)).toBe(2);
    expect([...store.files.keys()].sort()).toEqual(["avatars/u10/cccccccccccccccccccccccccccccccc.webp", "forms/ALPHA/photo.webp"]);
    await expect(deleteAvatarBlobs("../x", store)).rejects.toThrow();
  });
});

describe("the platform owner's switch", () => {
  const flip = (enabled: unknown) => ownerSwitch(new Request("http://localhost/api/admin/avatar-uploads", { method: "POST", headers: { authorization: "Bearer x", "content-type": "application/json" }, body: JSON.stringify({ enabled }) }));
  it("401 without a token, 403 for anyone but the owner, 400 for a non-boolean", async () => {
    mocks.verify.mockResolvedValue(null);
    expect((await flip(false)).status).toBe(401);
    signIn("admin1");
    expect((await flip(false)).status).toBe(403);
    signIn("owner");
    expect((await flip("no")).status).toBe(400);
  });
  it("the owner writes the additive field on appSettings/global (and turning it off makes the upload route refuse)", async () => {
    signIn("owner");
    expect((await flip(false)).status).toBe(200);
    expect(fake.read("appSettings/global")).toEqual({ avatarUploadsEnabled: false });
    signIn("u1");
    expect((await send(await jpeg())).status).toBe(403);
    signIn("owner");
    await flip(true);
    signIn("u1");
    expect((await send(await jpeg())).status).toBe(200);
  });
});

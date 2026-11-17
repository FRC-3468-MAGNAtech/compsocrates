import { describe, expect, it } from "vitest";
import { AVATAR_ERROR_MESSAGES, MAX_PICK_BYTES, avatarErrorMessage, checkPickedFile, cropRect } from "./crop";

describe("cropRect", () => {
  it("is the centered largest square at zoom 1", () => {
    expect(cropRect({ width: 400, height: 200, zoom: 1, x: 0, y: 0 })).toEqual({ sx: 100, sy: 0, size: 200 });
    expect(cropRect({ width: 200, height: 400, zoom: 1, x: 0, y: 0 })).toEqual({ sx: 0, sy: 100, size: 200 });
  });
  it("zooming shrinks the square around the center", () => {
    expect(cropRect({ width: 400, height: 400, zoom: 2, x: 0, y: 0 })).toEqual({ sx: 100, sy: 100, size: 200 });
  });
  it("repositioning moves it, and never leaves the picture", () => {
    expect(cropRect({ width: 400, height: 200, zoom: 1, x: -1, y: 0 }).sx).toBe(0);
    expect(cropRect({ width: 400, height: 200, zoom: 1, x: 1, y: 0 }).sx).toBe(200);
    expect(cropRect({ width: 400, height: 200, zoom: 1, x: 9, y: -9 })).toEqual({ sx: 200, sy: 0, size: 200 });
    const r = cropRect({ width: 400, height: 400, zoom: 3, x: 1, y: 1 });
    expect(r.sx + r.size).toBeLessThanOrEqual(400);
    expect(r.sy + r.size).toBeLessThanOrEqual(400);
  });
  it("clamps the zoom to 1..3", () => {
    expect(cropRect({ width: 300, height: 300, zoom: 0.2, x: 0, y: 0 }).size).toBe(300);
    expect(cropRect({ width: 300, height: 300, zoom: 50, x: 0, y: 0 }).size).toBe(100);
  });
});

describe("checkPickedFile", () => {
  it("accepts JPEG, PNG, WebP and HEIC (by type or by name)", () => {
    for (const f of [{ name: "a.jpg", type: "image/jpeg" }, { name: "a.png", type: "image/png" }, { name: "a.webp", type: "image/webp" }, { name: "IMG_1.HEIC", type: "image/heic" }, { name: "IMG_2.heic", type: "" }]) {
      expect(checkPickedFile({ ...f, size: 1000 })).toEqual({ ok: true });
    }
  });
  it("refuses SVG, GIF, PDF and an oversized file", () => {
    for (const f of [{ name: "a.svg", type: "image/svg+xml" }, { name: "a.gif", type: "image/gif" }, { name: "a.pdf", type: "application/pdf" }]) {
      expect(checkPickedFile({ ...f, size: 1000 })).toEqual({ ok: false, code: "wrong-type" });
    }
    expect(checkPickedFile({ name: "a.jpg", type: "image/jpeg", size: MAX_PICK_BYTES + 1 })).toEqual({ ok: false, code: "too-big" });
  });
});

describe("messages for the server's codes", () => {
  it("every code the routes return has a plain message", () => {
    for (const code of ["wrong-type", "too-big", "uploads-off", "not-configured", "rate-limited", "bad-image"]) expect(AVATAR_ERROR_MESSAGES[code]).toBeTruthy();
    expect(avatarErrorMessage("rate-limited")).toMatch(/try again/i);
    expect(avatarErrorMessage("unknown-code")).toMatch(/try again/i);
    expect(avatarErrorMessage(null, "custom")).toBe("custom");
  });
});

import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { AVATAR_MAX_PIXELS, AVATAR_OUTPUT_SIZE, processAvatar, sniffImageType } from "./avatar-image";

// Real (small, synthetic) image bytes through the real image library: no mocks, no files, no network.
const solid = (w: number, h: number, rgb = { r: 200, g: 30, b: 30 }) => sharp({ create: { width: w, height: h, channels: 3, background: rgb } });
const jpeg = (w = 64, h = 32) => solid(w, h).jpeg().toBuffer();
const png = (w = 64, h = 32) => solid(w, h).png().toBuffer();

describe("sniffImageType: by the bytes only", () => {
  it("accepts JPEG, PNG and WebP", async () => {
    expect(sniffImageType(await jpeg())).toBe("jpeg");
    expect(sniffImageType(await png())).toBe("png");
    expect(sniffImageType(await solid(8, 8).webp().toBuffer())).toBe("webp");
  });
  it("refuses SVG, GIF, HEIC and text, whatever they are called", () => {
    const text = (s: string) => new Uint8Array(Buffer.from(s));
    expect(sniffImageType(text('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(sniffImageType(text("GIF89a......"))).toBeNull();
    expect(sniffImageType(new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]))).toBeNull(); // ftypheic
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
  });
});

describe("processAvatar", () => {
  it("outputs a centered 512 x 512 WebP from a wide JPEG, a tall PNG and a small image", async () => {
    for (const input of [await jpeg(200, 80), await png(80, 200), await jpeg(20, 20)]) {
      const out = await processAvatar(input);
      expect(out.ok).toBe(true);
      if (!out.ok) continue;
      expect([out.width, out.height]).toEqual([AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE]);
      const meta = await sharp(out.data).metadata();
      expect(meta.format).toBe("webp");
      expect([meta.width, meta.height]).toEqual([AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE]);
    }
  });

  it("strips ALL metadata: EXIF, GPS, camera data and the color profile do not survive", async () => {
    const withMeta = await solid(120, 60)
      .jpeg()
      .withExif({
        IFD0: { Make: "SecretCam", Model: "X100", Copyright: "private person", ImageDescription: "my home address" },
        IFD3: { GPSLatitudeRef: "N", GPSLatitude: "37/1 25/1 1912/100", GPSLongitudeRef: "W", GPSLongitude: "122/1 5/1 2476/100" },
      })
      .withIccProfile("p3")
      .toBuffer();
    const before = await sharp(withMeta).metadata();
    expect(before.exif).toBeDefined();
    expect(before.icc).toBeDefined();
    expect(withMeta.includes(Buffer.from("SecretCam"))).toBe(true);

    const out = await processAvatar(withMeta);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const after = await sharp(out.data).metadata();
    expect(after.exif).toBeUndefined();
    expect(after.icc).toBeUndefined();
    expect(after.xmp).toBeUndefined();
    expect(after.iptc).toBeUndefined();
    expect(after.orientation).toBeUndefined();
    for (const secret of ["SecretCam", "X100", "private person", "my home address", "GPS", "Exif"]) expect(out.data.includes(Buffer.from(secret))).toBe(false);
  });

  it("auto-orients from EXIF before stripping it: a picture tagged 'rotate 90 clockwise' comes out upright", async () => {
    // Stored 64 x 32: left half red, right half blue, tagged orientation 6. Upright it is 32 wide x 64 tall with red on TOP and blue at the BOTTOM.
    const left = await solid(32, 32, { r: 255, g: 0, b: 0 }).png().toBuffer();
    const right = await solid(32, 32, { r: 0, g: 0, b: 255 }).png().toBuffer();
    const tagged = await sharp({ create: { width: 64, height: 32, channels: 3, background: "#000" } })
      .composite([{ input: left, left: 0, top: 0 }, { input: right, left: 32, top: 0 }])
      .jpeg({ quality: 100 })
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const out = await processAvatar(tagged);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const { data, info } = await sharp(out.data).raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => [data[(y * info.width + x) * info.channels], data[(y * info.width + x) * info.channels + 2]];
    const [topR, topB] = px(256, 20);
    const [bottomR, bottomB] = px(256, 490);
    expect(topR).toBeGreaterThan(150);
    expect(topB).toBeLessThan(100);
    expect(bottomB).toBeGreaterThan(150);
    expect(bottomR).toBeLessThan(100);
  });

  it("refuses a spoofed type: SVG, text or a GIF named .jpg", async () => {
    expect(await processAvatar(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'))).toEqual({ ok: false, code: "bad-type" });
    expect(await processAvatar(Buffer.from("not an image at all"))).toEqual({ ok: false, code: "bad-type" });
    expect(await processAvatar(await solid(8, 8).gif().toBuffer())).toEqual({ ok: false, code: "bad-type" });
  });

  it("refuses an animated WebP", async () => {
    const frames = [await solid(16, 16).png().toBuffer(), await solid(16, 16, { r: 0, g: 200, b: 0 }).png().toBuffer()];
    const animated = await sharp(frames, { join: { animated: true } }).webp().toBuffer();
    expect((await sharp(animated, { animated: true }).metadata()).pages).toBe(2);
    expect(await processAvatar(animated)).toEqual({ ok: false, code: "animated" });
  });

  it("refuses a picture over the pixel limit before decoding it", async () => {
    const side = Math.ceil(Math.sqrt(AVATAR_MAX_PIXELS)) + 10;
    const huge = await sharp({ create: { width: side, height: side, channels: 3, background: "#fff" } }).png({ compressionLevel: 9 }).toBuffer();
    const out = await processAvatar(huge);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("too-many-pixels");
  }, 60000);

  it("fails closed on a truncated or corrupt file", async () => {
    const good = await jpeg(64, 64);
    const out = await processAvatar(good.subarray(0, 40));
    expect(out).toEqual({ ok: false, code: "bad-image" });
    expect(await processAvatar(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(50, 7)]))).toEqual({ ok: false, code: "bad-image" });
  });
});

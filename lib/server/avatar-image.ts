import "server-only";
import sharp from "sharp";

// Session 8: the ONE place an uploaded picture is checked and re-encoded. The browser downscales before sending (Vercel's body limit is about 4.5 MB), but
// nothing it says is trusted: the type is decided by the bytes, the pixels are capped before decoding, and the result is a NEW image (a centered square WebP)
// with every piece of metadata gone: EXIF (camera, GPS, orientation), XMP, IPTC, thumbnails and the embedded color profile. `withMetadata` is never called.

export const AVATAR_OUTPUT_SIZE = 512;
export const AVATAR_OUTPUT_QUALITY = 80;
/** Largest accepted body (the route checks the same number). */
export const AVATAR_MAX_BYTES = 3 * 1024 * 1024;
/** Decode limit: 6000 x 6000. A bigger picture (or a decompression bomb) is refused before it is decoded. */
export const AVATAR_MAX_PIXELS = 36_000_000;

export type AvatarImageError = "bad-type" | "animated" | "too-many-pixels" | "bad-image";

export type ProcessedAvatar = { ok: true; data: Buffer; width: number; height: number; contentType: "image/webp" } | { ok: false; code: AvatarImageError };

/** The type from the first bytes: JPEG, PNG or WebP. SVG, GIF, HEIC and everything else are null. (The browser's MIME type and the file name are never consulted.) */
export function sniffImageType(bytes: Uint8Array): "jpeg" | "png" | "webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return "png";
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "webp";
  return null;
}

/** Fails closed: any decoder problem is `bad-image`; nothing is stored unless the whole pipeline succeeded. */
export async function processAvatar(input: Uint8Array): Promise<ProcessedAvatar> {
  if (!sniffImageType(input)) return { ok: false, code: "bad-type" };
  try {
    const source = sharp(input, { limitInputPixels: AVATAR_MAX_PIXELS, failOn: "error", animated: false });
    const meta = await source.metadata();
    if ((meta.pages ?? 1) > 1) return { ok: false, code: "animated" };
    if (!meta.width || !meta.height) return { ok: false, code: "bad-image" };
    if (meta.width * meta.height > AVATAR_MAX_PIXELS) return { ok: false, code: "too-many-pixels" };
    const { data, info } = await source
      .rotate() // auto-orient from EXIF FIRST, so the picture is upright once the orientation tag is gone
      .resize(AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE, { fit: "cover", position: "centre" })
      .webp({ quality: AVATAR_OUTPUT_QUALITY })
      .toBuffer({ resolveWithObject: true });
    return { ok: true, data, width: info.width, height: info.height, contentType: "image/webp" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    return { ok: false, code: /pixel limit|exceeds/i.test(message) ? "too-many-pixels" : "bad-image" };
  }
}

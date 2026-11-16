// Session 8: the square crop the person frames in the upload dialog (zoom and reposition). Pure.
import { STORE_ACCESS_MISMATCH_FRIENDLY } from "@/lib/blob/errors";

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 3;
/** Size of the square the browser sends (the server re-encodes to 512 px anyway). Large phone photos are downscaled to this before they travel. */
export const TRANSPORT_SIZE = 1024;
/** A picture file bigger than this is refused up front, before the browser tries to decode it. */
export const MAX_PICK_BYTES = 30 * 1024 * 1024;

export type CropInput = { width: number; height: number; zoom: number; /** -1 (left / top) to 1 (right / bottom); 0 is centered. */ x: number; y: number };
export type CropRect = { sx: number; sy: number; size: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The square of the source picture that is visible: the largest centered square divided by the zoom, moved by the offsets, never outside the picture. */
export function cropRect({ width, height, zoom, x, y }: CropInput): CropRect {
  const base = Math.min(width, height);
  const size = base / clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  const spareX = width - size;
  const spareY = height - size;
  return { sx: clamp(spareX / 2 + (clamp(x, -1, 1) * spareX) / 2, 0, spareX), sy: clamp(spareY / 2 + (clamp(y, -1, 1) * spareY) / 2, 0, spareY), size };
}

export type PickCheck = { ok: true } | { ok: false; code: "wrong-type" | "too-big" };

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const ALLOWED_EXTENSIONS = /\.(jpe?g|png|webp|heic|heif)$/i;

/** A first look at a picked file (the server decides by the bytes again). HEIC is allowed here: the browser converts it when it can decode it. */
export function checkPickedFile(file: { name: string; type: string; size: number }): PickCheck {
  if (!ALLOWED_TYPES.includes(file.type.toLowerCase()) && !ALLOWED_EXTENSIONS.test(file.name)) return { ok: false, code: "wrong-type" };
  if (file.size > MAX_PICK_BYTES) return { ok: false, code: "too-big" };
  return { ok: true };
}

/** The friendly text for a failure: the server's `code` (or one of the browser's own). */
export const AVATAR_ERROR_MESSAGES: Record<string, string> = {
  "wrong-type": "Use a JPEG, PNG or WebP picture.",
  "too-big": "That picture is too large. Try a smaller one.",
  "bad-image": "That picture couldn't be read. Try a different file.",
  "uploads-off": "Picture uploads are turned off for now. You can still pick your initials, your Google picture or a preset.",
  "not-configured": "Picture uploads aren't set up on this server yet. You can still pick your initials, your Google picture or a preset.",
  "store-access-mismatch": STORE_ACCESS_MISMATCH_FRIENDLY,
  "rate-limited": "You've uploaded a lot of pictures. Try again in a while.",
  "not-signed-in": "You're signed out. Sign in again and retry.",
  heic: "This browser can't read HEIC photos. Choose a JPEG or PNG, or set your iPhone camera to Most Compatible (Settings > Camera > Formats).",
  "network": "The picture couldn't be sent. Check your connection and try again.",
};

export const avatarErrorMessage = (code: string | null | undefined, fallback = "The picture couldn't be saved. Try again."): string => (code && AVATAR_ERROR_MESSAGES[code]) || fallback;

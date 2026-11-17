"use client";

import { ApiError, authedApi } from "@/lib/api-client";
import { auth } from "@/lib/firebase/client";
import type { ProgramId } from "@/config/programs/types";
import { TRANSPORT_SIZE, cropRect, type CropInput } from "@/lib/avatar/crop";

// Session 8: the browser side of a picture upload. The picked photo is decoded here (a phone photo can be 12 MP and 5 MB or more), the visible square is drawn
// onto a canvas at most 1024 px wide and sent as a JPEG, well under Vercel's request limit (about 4.5 MB) and the route's own 3 MB cap. The server re-encodes it anyway.

export class AvatarClientError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export type DecodedPicture = { bitmap: ImageBitmap; width: number; height: number };

/**
 * Decodes the picked file with the browser's own decoder, upright (EXIF orientation applied). HEIC works only where the browser can decode it (Safari on iPhone and
 * Mac); anywhere else it is REJECTED with a message that says what to do, not converted.
 */
export async function decodePicture(file: File): Promise<DecodedPicture> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { bitmap, width: bitmap.width, height: bitmap.height };
  } catch {
    const isHeic = /image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
    throw new AvatarClientError(isHeic ? "heic" : "bad-image", isHeic ? "heic" : "bad-image");
  }
}

/** Draws the framed square (crop rect scaled to at most TRANSPORT_SIZE) into a canvas. */
export function drawCrop(canvas: HTMLCanvasElement, picture: DecodedPicture, crop: Omit<CropInput, "width" | "height">, outSize: number) {
  const rect = cropRect({ width: picture.width, height: picture.height, ...crop });
  canvas.width = outSize;
  canvas.height = outSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new AvatarClientError("bad-image", "bad-image");
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#ffffff"; // a transparent PNG becomes white rather than black in the JPEG
  ctx.fillRect(0, 0, outSize, outSize);
  ctx.drawImage(picture.bitmap, rect.sx, rect.sy, rect.size, rect.size, 0, 0, outSize, outSize);
}

/** The framed square as a JPEG blob at transport size. */
export async function renderTransportJpeg(picture: DecodedPicture, crop: Omit<CropInput, "width" | "height">): Promise<Blob> {
  const rect = cropRect({ width: picture.width, height: picture.height, ...crop });
  const canvas = document.createElement("canvas");
  drawCrop(canvas, picture, crop, Math.max(64, Math.min(TRANSPORT_SIZE, Math.floor(rect.size))));
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  if (!blob) throw new AvatarClientError("bad-image", "bad-image");
  return blob;
}

/** POSTs the bytes to /api/avatar with the signed-in person's token, reporting upload progress (0 to 1). Resolves with the new picture's URL. */
export async function uploadAvatarBlob(blob: Blob, onProgress?: (ratio: number) => void): Promise<string> {
  if (!auth.currentUser) throw new AvatarClientError("not-signed-in", "not-signed-in");
  const token = await auth.currentUser.getIdToken();
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/avatar");
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("Content-Type", blob.type || "image/jpeg");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new AvatarClientError("network", "network"));
    xhr.onload = () => {
      let json: { ok?: boolean; code?: string; url?: string } = {};
      try {
        json = JSON.parse(xhr.responseText) as typeof json;
      } catch {
        // not JSON (a platform error page): treated as a failure below
      }
      if (xhr.status >= 200 && xhr.status < 300 && json.ok !== false && typeof json.url === "string") resolve(json.url);
      else reject(new AvatarClientError(xhr.status === 413 ? "too-big" : (json.code ?? "network"), json.code ?? String(xhr.status)));
    };
    xhr.send(blob);
  });
}

/** Removes your own uploaded picture (the file and the stored fields). Throws when it could not, so a caller never moves on as if it had. */
export async function removeMyAvatar(): Promise<void> {
  try {
    await authedApi("/api/avatar", { method: "DELETE" });
  } catch (err) {
    throw new AvatarClientError(err instanceof ApiError ? (err.code ?? "network") : "network", "remove-failed");
  }
}

/** An admin of the member's team (or the platform owner) removes a member's uploaded picture. */
export async function removeMemberAvatar(program: ProgramId, uid: string): Promise<void> {
  await authedApi("/api/avatar/remove", { method: "POST", body: { program, uid } });
}

/** The platform owner's switch (Admin Panel > Platform owner settings). */
export async function setAvatarUploadsEnabled(enabled: boolean): Promise<void> {
  await authedApi("/api/admin/avatar-uploads", { method: "POST", body: { enabled } });
}

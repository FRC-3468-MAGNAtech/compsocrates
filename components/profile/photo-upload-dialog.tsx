"use client";

import { useEffect, useRef, useState } from "react";
import { Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { AvatarClientError, decodePicture, drawCrop, renderTransportJpeg, type DecodedPicture } from "@/lib/avatar/client";
import { MAX_ZOOM, MIN_ZOOM, avatarErrorMessage, checkPickedFile } from "@/lib/avatar/crop";

const PREVIEW_PX = 240;

/**
 * Upload a profile photo (Account Settings > Picture). The one dialog for both programs. The person picks a photo, frames it (zoom and reposition; the server
 * would center-crop otherwise), and sees exactly the square that will be saved. Large phone photos are downscaled in the browser before sending. The dialog says what is
 * appropriate and that team admins can remove photos. `onUpload` does the sending (and rejects with a code the dialog turns into a message).
 */
export function PhotoUploadDialog({ open, onClose, onUpload }: { open: boolean; onClose: () => void; onUpload: (blob: Blob, onProgress: (ratio: number) => void) => Promise<void> }) {
  const [picture, setPicture] = useState<DecodedPicture | null>(null);
  const [zoom, setZoom] = useState(1);
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Redraw the preview whenever the picture or the framing changes.
  useEffect(() => {
    if (picture && canvasRef.current) drawCrop(canvasRef.current, picture, { zoom, x, y }, PREVIEW_PX);
  }, [picture, zoom, x, y]);

  const reset = () => {
    picture?.bitmap.close();
    setPicture(null);
    setZoom(1);
    setX(0);
    setY(0);
    setError(null);
    setBusy(false);
    setProgress(0);
  };
  const close = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    const check = checkPickedFile(file);
    if (!check.ok) {
      setError(avatarErrorMessage(check.code));
      return;
    }
    try {
      const decoded = await decodePicture(file);
      picture?.bitmap.close();
      setPicture(decoded);
      setZoom(1);
      setX(0);
      setY(0);
    } catch (err) {
      setError(avatarErrorMessage(err instanceof AvatarClientError ? err.code : "bad-image"));
    }
  };

  const upload = async () => {
    if (!picture) return;
    setBusy(true);
    setError(null);
    setProgress(0);
    try {
      const blob = await renderTransportJpeg(picture, { zoom, x, y });
      await onUpload(blob, setProgress);
      reset();
      onClose();
    } catch (err) {
      setError(avatarErrorMessage(err instanceof AvatarClientError ? err.code : "network"));
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="glass-overlay max-h-[90dvh] w-[min(94vw,460px)] overflow-y-auto" data-testid="photo-upload-dialog">
        <DialogTitle>Upload a photo</DialogTitle>
        <DialogDescription>
          Choose a clear picture of yourself that is appropriate for a student team. Team admins can remove photos. The picture is cropped to a square and saved at a small size; location and camera details are removed.
        </DialogDescription>
        <div className="mt-4 flex flex-col items-center gap-4">
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif"
            className="sr-only"
            data-testid="photo-file-input"
            aria-label="Choose a photo"
            onChange={(e) => {
              void pick(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <Button variant="outline" className="min-h-11 gap-2" disabled={busy} onClick={() => inputRef.current?.click()}>
            <Camera className="h-4 w-4" aria-hidden /> {picture ? "Choose a different photo" : "Choose a photo"}
          </Button>
          {picture && (
            <>
              <canvas ref={canvasRef} width={PREVIEW_PX} height={PREVIEW_PX} className="h-[240px] w-[240px] rounded-full border border-[var(--glass-border)]" role="img" aria-label="Preview of your photo" data-testid="photo-preview" />
              <div className="flex w-full flex-col gap-3 text-xs text-[var(--muted-foreground)]">
                <label className="flex flex-col gap-1">
                  Zoom
                  <input type="range" min={MIN_ZOOM} max={MAX_ZOOM} step={0.05} value={zoom} disabled={busy} onChange={(e) => setZoom(Number(e.target.value))} className="h-11 w-full" />
                </label>
                <label className="flex flex-col gap-1">
                  Move left or right
                  <input type="range" min={-1} max={1} step={0.02} value={x} disabled={busy} onChange={(e) => setX(Number(e.target.value))} className="h-11 w-full" />
                </label>
                <label className="flex flex-col gap-1">
                  Move up or down
                  <input type="range" min={-1} max={1} step={0.02} value={y} disabled={busy} onChange={(e) => setY(Number(e.target.value))} className="h-11 w-full" />
                </label>
              </div>
            </>
          )}
          {busy && (
            <div className="flex w-full flex-col gap-1.5" role="status" aria-live="polite">
              <Progress value={Math.round(progress * 100)} max={100} label="Upload progress" valueText={`${Math.round(progress * 100)} percent uploaded`} />
              <span className="text-xs text-[var(--muted-foreground)]">Uploading…</span>
            </div>
          )}
          {error && (
            <p role="alert" data-testid="photo-error" className="w-full text-sm text-red-400">
              {error}
            </p>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" className="min-h-11" disabled={busy} onClick={close}>
            Cancel
          </Button>
          <Button className="min-h-11" disabled={!picture || busy} onClick={() => void upload()} data-testid="photo-upload-submit">
            {busy ? "Uploading…" : "Upload photo"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
